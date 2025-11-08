import { type FileBus, toFileBus } from '../../../../lib/file-bus';
import type { RtcEndpoint } from '../../../../lib/webrtc';

export interface FileTransferMeta {
  id: string;
  name: string;
  size: number;
  addedAt?: number;
  hash?: string;
}

type TransferControlMessage =
  | {
      type: 'transfer:start';
      meta: FileTransferMeta;
      totalChunks: number;
      chunkSize: number;
      totalBytes: number;
    }
  | {
      type: 'transfer:ack';
      id: string;
    }
  | {
      type: 'transfer:cancel';
      id: string;
      reason?: string;
    }
  | {
      type: 'transfer:error';
      id: string;
      reason: string;
    };

export interface FileTransferOptions {
  chunkSize?: number;
  lowWaterMark?: number;
  dataChannelLabel?: string;
  minBatchChunks?: number;
  maxBatchChunks?: number;
  fastThresholdMs?: number;
  slowThresholdMs?: number;
}

type TransferEvent =
  | {
      status: 'complete';
      meta: FileTransferMeta;
      blob: Blob;
    }
  | {
      status: 'cancelled';
      meta: FileTransferMeta;
      reason?: string;
    }
  | {
      status: 'error';
      meta: FileTransferMeta;
      reason: string;
    };

interface SendState {
  meta: FileTransferMeta;
  controller: AbortController;
  resolve: () => void;
  reject: (reason: unknown) => void;
  ack: Promise<void>;
  ackResolve: () => void;
  ackReject: (reason: unknown) => void;
  cancelled: boolean;
}

interface ReceiveState {
  meta: FileTransferMeta;
  totalChunks: number;
  chunkSize: number;
  totalBytes: number;
  chunks: BlobPart[];
  nextSeq: number;
  receivedBytes: number;
  cancelled: boolean;
}

const VERSION = 1;
const HEADER_BYTES = 4;

export class FileTransfer {
  private readonly endpoint: RtcEndpoint;
  private readonly bus: FileBus;
  private readonly opts: Required<
    Pick<
      FileTransferOptions,
      | 'chunkSize'
      | 'lowWaterMark'
      | 'dataChannelLabel'
      | 'minBatchChunks'
      | 'maxBatchChunks'
      | 'fastThresholdMs'
      | 'slowThresholdMs'
    >
  >;
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  private readonly listeners = new Set<(event: TransferEvent) => void>();
  private readonly sendStates = new Map<string, SendState>();
  private readonly receiveStates = new Map<string, ReceiveState>();
  private readonly cleanupCallbacks: Array<() => void> = [];

  private currentBatchSize: number;

  private dataChannelPromise: Promise<RTCDataChannel>;

  public constructor(endpoint: RtcEndpoint, bus?: FileBus, options?: FileTransferOptions) {
    this.endpoint = endpoint;
    this.bus = bus ?? toFileBus(endpoint);
    this.opts = {
      chunkSize: Math.max(1024, options?.chunkSize ?? 16 * 1024),
      lowWaterMark: options?.lowWaterMark ?? 1_000_000,
      dataChannelLabel: options?.dataChannelLabel ?? 'file-data',
      minBatchChunks: Math.max(1, options?.minBatchChunks ?? 4),
      maxBatchChunks: Math.max(options?.minBatchChunks ?? 4, options?.maxBatchChunks ?? 32),
      fastThresholdMs: options?.fastThresholdMs ?? 35,
      slowThresholdMs: options?.slowThresholdMs ?? 250,
    };

    this.currentBatchSize = Math.min(
      this.opts.maxBatchChunks,
      Math.max(this.opts.minBatchChunks, Math.floor(this.opts.lowWaterMark / this.opts.chunkSize)),
    );

    this.dataChannelPromise = this.ensureDataChannel();

    const offCtrl = this.bus.onJSON(this.handleControlMessage);
    this.cleanupCallbacks.push(offCtrl);
  }

  public async send(file: File, meta: FileTransferMeta): Promise<void> {
    const { channel, totalChunks, state, completion } = await this.prepareSend(meta, file);

    try {
      await this.streamFile(channel, file, meta, totalChunks, state);
      await state.ack;
      state.resolve();
    } catch (error) {
      state.reject(error);
      if (!state.cancelled) {
        this.bus.sendJSON({
          type: 'transfer:error',
          id: meta.id,
          reason: error instanceof Error ? error.message : 'transfer_failed',
        } satisfies TransferControlMessage);
      }
      throw error;
    } finally {
      this.sendStates.delete(meta.id);
    }

    await completion;
  }

  public onFile(listener: (event: TransferEvent) => void): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  private async prepareSend(
    meta: FileTransferMeta,
    file: File,
  ): Promise<{
    channel: RTCDataChannel;
    totalChunks: number;
    state: SendState;
    completion: Promise<void>;
  }> {
    if (this.sendStates.has(meta.id)) {
      throw new Error(`transfer already in progress for ${meta.id}`);
    }
    if (file.size !== meta.size) {
      throw new Error(`Provided size ${meta.size} does not match file size ${file.size}`);
    }
    const channel = await this.dataChannelPromise;
    if (channel.readyState !== 'open') {
      await this.waitChannelOpen(channel);
    }

    const totalChunks = Math.max(1, Math.ceil(file.size / this.opts.chunkSize));
    const controller = new AbortController();

    let resolveSend!: () => void;
    let rejectSend!: (reason: unknown) => void;
    const completion = new Promise<void>((resolve, reject) => {
      resolveSend = resolve;
      rejectSend = reject;
    });
    let ackResolve!: () => void;
    let ackReject!: (reason: unknown) => void;
    const ack = new Promise<void>((resolve, reject) => {
      ackResolve = resolve;
      ackReject = reject;
    });

    const state: SendState = {
      meta,
      controller,
      resolve: resolveSend,
      reject: rejectSend,
      ack,
      ackResolve,
      ackReject,
      cancelled: false,
    };

    this.sendStates.set(meta.id, state);

    this.bus.sendJSON({
      type: 'transfer:start',
      meta,
      totalChunks,
      chunkSize: this.opts.chunkSize,
      totalBytes: file.size,
    } satisfies TransferControlMessage);

    return { channel, totalChunks, state, completion };
  }

  public cancel(id: string, reason: string = 'cancelled'): void {
    const sendState = this.sendStates.get(id);
    if (sendState) {
      sendState.cancelled = true;
      sendState.controller.abort();
      sendState.reject(new Error(reason));
      sendState.ackReject(new Error(reason));
      this.sendStates.delete(id);
      this.bus.sendJSON({ type: 'transfer:cancel', id, reason } satisfies TransferControlMessage);
    }
    const receiveState = this.receiveStates.get(id);
    if (receiveState) {
      receiveState.cancelled = true;
      this.receiveStates.delete(id);
      this.emit({
        status: 'cancelled',
        meta: receiveState.meta,
        reason,
      });
      this.bus.sendJSON({ type: 'transfer:cancel', id, reason } satisfies TransferControlMessage);
    }
  }

  public dispose(): void {
    const callbacks = this.cleanupCallbacks.splice(0);
    for (const fn of callbacks) {
      try {
        fn();
      } catch {}
    }
    for (const state of this.sendStates.values()) {
      state.cancelled = true;
      state.controller.abort();
      state.reject(new Error('disposed'));
      state.ackReject(new Error('disposed'));
    }
    this.sendStates.clear();
    this.receiveStates.clear();
    this.listeners.clear();
    void this.dataChannelPromise.then((channel) => {
      try {
        channel.close();
      } catch {}
    });
  }

  private ensureDataChannel(): Promise<RTCDataChannel> {
    const label = this.opts.dataChannelLabel;
    const { pc } = this.endpoint;

    return new Promise<RTCDataChannel>((resolve, reject) => {
      let resolved = false;
      const cleanup = (): void => {
        pc.removeEventListener('datachannel', handleIncoming);
      };

      const finish = (channel: RTCDataChannel): void => {
        if (resolved) return;
        resolved = true;
        cleanup();
        this.prepareChannel(channel, resolve, reject);
      };

      const handleIncoming = (event: RTCDataChannelEvent): void => {
        if (event.channel.label === label) {
          finish(event.channel);
        }
      };

      pc.addEventListener('datachannel', handleIncoming);

      const shouldCreate = pc.localDescription?.type === 'offer';
      if (shouldCreate) {
        try {
          const channel = pc.createDataChannel(label, { ordered: true });
          finish(channel);
        } catch (error) {
          cleanup();
          reject(error);
        }
      }
    });
  }

  private prepareChannel(
    channel: RTCDataChannel,
    resolve: (channel: RTCDataChannel) => void,
    reject: (error: unknown) => void,
  ): void {
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = this.opts.lowWaterMark;

    const handleMessage = (event: MessageEvent<unknown>): void => {
      const data = event.data;
      if (data instanceof ArrayBuffer) {
        this.handleChunk(data);
        return;
      }
      if (ArrayBuffer.isView(data)) {
        const view = data as ArrayBufferView;
        const copy = new Uint8Array(view.byteLength);
        copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
        this.handleChunk(copy.buffer);
        return;
      }
      if (typeof Blob !== 'undefined' && data instanceof Blob) {
        void data
          .arrayBuffer()
          .then((buf) => this.handleChunk(buf))
          .catch(() => {});
      }
    };
    const handleError = (event: Event | RTCErrorEvent): void => {
      reject(event);
    };
    const handleClose = (): void => {
      const error = new Error('file channel closed');
      for (const state of this.sendStates.values()) {
        state.cancelled = true;
        state.reject(error);
        state.ackReject(error);
      }
      this.sendStates.clear();
      this.receiveStates.clear();
      reject(error);
    };

    channel.addEventListener('message', handleMessage as EventListener);
    channel.addEventListener('error', handleError);
    channel.addEventListener('close', handleClose);

    const openListener = (): void => {
      channel.removeEventListener('open', openListener);
      resolve(channel);
    };
    if (channel.readyState === 'open') {
      resolve(channel);
    } else {
      channel.addEventListener('open', openListener);
    }

    this.cleanupCallbacks.push(() => {
      channel.removeEventListener('message', handleMessage as EventListener);
      channel.removeEventListener('error', handleError);
      channel.removeEventListener('close', handleClose);
      channel.removeEventListener('open', openListener);
    });
  }

  private async waitChannelOpen(channel: RTCDataChannel): Promise<void> {
    if (channel.readyState === 'open') return;
    await new Promise<void>((resolve, reject) => {
      const handleOpen = (): void => {
        cleanup();
        resolve();
      };
      const handleClose = (): void => {
        cleanup();
        reject(new Error('channel closed before opening'));
      };
      const cleanup = (): void => {
        channel.removeEventListener('open', handleOpen);
        channel.removeEventListener('close', handleClose);
      };
      channel.addEventListener('open', handleOpen);
      channel.addEventListener('close', handleClose);
    });
  }

  private handleControlMessage = (raw: unknown): void => {
    const msg = raw as Partial<TransferControlMessage> & { type?: string };
    if (!msg || typeof msg.type !== 'string') return;
    if (!msg.type.startsWith('transfer:')) return;

    switch (msg.type) {
      case 'transfer:start':
        this.startReceive(msg as TransferControlMessage & { type: 'transfer:start' });
        break;
      case 'transfer:ack': {
        const { id } = msg as TransferControlMessage & { type: 'transfer:ack' };
        const sendState = this.sendStates.get(id);
        if (sendState) {
          sendState.ackResolve();
        }
        break;
      }
      case 'transfer:cancel': {
        const { id, reason } = msg as TransferControlMessage & { type: 'transfer:cancel' };
        const sending = this.sendStates.get(id);
        if (sending) {
          sending.cancelled = true;
          sending.controller.abort();
          sending.reject(new Error(reason ?? 'peer_cancelled'));
          sending.ackReject(new Error(reason ?? 'peer_cancelled'));
          this.sendStates.delete(id);
        }
        const receiving = this.receiveStates.get(id);
        if (receiving) {
          receiving.cancelled = true;
          this.receiveStates.delete(id);
          this.emit({
            status: 'cancelled',
            meta: receiving.meta,
            reason,
          });
        }
        break;
      }
      case 'transfer:error': {
        const { id, reason } = msg as TransferControlMessage & { type: 'transfer:error' };
        const meta = this.sendStates.get(id)?.meta ??
          this.receiveStates.get(id)?.meta ?? { id, name: 'unknown', size: 0 };
        this.emit({
          status: 'error',
          meta,
          reason: reason ?? 'unknown_error',
        });
        break;
      }
      default:
        break;
    }
  };

  private startReceive(message: TransferControlMessage & { type: 'transfer:start' }): void {
    const { meta, totalChunks, chunkSize, totalBytes } = message;
    const existingSend = this.sendStates.get(meta.id);
    if (existingSend) {
      // collision: both sides sending same id -> cancel remote
      this.bus.sendJSON({
        type: 'transfer:cancel',
        id: meta.id,
        reason: 'conflict',
      } satisfies TransferControlMessage);
      return;
    }

    this.receiveStates.set(meta.id, {
      meta,
      totalChunks,
      chunkSize,
      totalBytes,
      chunks: [],
      nextSeq: 0,
      receivedBytes: 0,
      cancelled: false,
    });
  }

  private handleChunk(buffer: ArrayBuffer): void {
    try {
      const { header, payload } = this.decodeChunk(buffer);
      const state = this.receiveStates.get(header.id);
      if (!state || state.cancelled) return;

      if (header.seq !== state.nextSeq) {
        this.bus.sendJSON({
          type: 'transfer:cancel',
          id: header.id,
          reason: 'sequence_mismatch',
        } satisfies TransferControlMessage);
        this.receiveStates.delete(header.id);
        this.emit({
          status: 'cancelled',
          meta: state.meta,
          reason: 'sequence_mismatch',
        });
        return;
      }

      state.nextSeq += 1;
      state.receivedBytes += payload.byteLength;
      if (payload.byteLength > 0) {
        const copy = new Uint8Array(payload.byteLength);
        copy.set(payload);
        state.chunks.push(copy.buffer);
      }

      if (header.last) {
        if (state.receivedBytes !== state.totalBytes || state.nextSeq !== state.totalChunks) {
          this.bus.sendJSON({
            type: 'transfer:error',
            id: header.id,
            reason: 'total_mismatch',
          } satisfies TransferControlMessage);
          this.receiveStates.delete(header.id);
          return;
        }

        const blob = new Blob(state.chunks, { type: 'application/octet-stream' });
        const meta = state.meta;
        this.receiveStates.delete(header.id);
        this.bus.sendJSON({ type: 'transfer:ack', id: header.id } satisfies TransferControlMessage);
        this.emit({
          status: 'complete',
          meta,
          blob,
        });
      }
    } catch (error) {
      // if we fail decoding, notify peer
      const reason = error instanceof Error ? error.message : 'decode_error';
      this.bus.sendJSON({
        type: 'transfer:error',
        id:
          typeof error === 'object' && error !== null && 'id' in error
            ? (error as { id: string }).id
            : 'unknown',
        reason,
      } satisfies TransferControlMessage);
    }
  }

  private decodeChunk(buffer: ArrayBuffer): {
    header: {
      version: number;
      id: string;
      seq: number;
      totalChunks: number;
      totalBytes: number;
      chunkBytes: number;
      last: boolean;
    };
    payload: Uint8Array;
  } {
    if (buffer.byteLength < HEADER_BYTES) throw new Error('chunk_too_small');
    const view = new DataView(buffer);
    const headerLen = view.getUint32(0, false);
    if (headerLen <= 0 || headerLen > buffer.byteLength - HEADER_BYTES) {
      throw new Error('header_size_invalid');
    }

    const headerBytes = new Uint8Array(buffer, HEADER_BYTES, headerLen);
    const headerText = this.decoder.decode(headerBytes);
    const header = JSON.parse(headerText) as {
      version: number;
      id: string;
      seq: number;
      totalChunks: number;
      totalBytes: number;
      chunkBytes: number;
      last: boolean;
    };

    if (header.version !== VERSION) throw new Error('unsupported_version');
    const payloadOffset = HEADER_BYTES + headerLen;
    if (payloadOffset > buffer.byteLength) throw new Error('payload_offset_invalid');

    const payload = new Uint8Array(buffer, payloadOffset);
    if (payload.byteLength !== header.chunkBytes) throw new Error('payload_size_mismatch');

    return { header, payload };
  }

  private async streamFile(
    channel: RTCDataChannel,
    file: File,
    meta: FileTransferMeta,
    totalChunks: number,
    state: SendState,
  ): Promise<void> {
    const reader = file.stream().getReader();
    let seq = 0;

    let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
    let done = false;
    let batchCounter = 0;

    while (!done && !state.cancelled) {
      // biome-ignore lint/performance/noAwaitInLoops: sequential streaming requires awaited reads
      const { value, done: readerDone } = await reader.read();
      if (readerDone) done = true;
      if (value) {
        const canonical = new Uint8Array(value);
        buffer = this.concatUint8(buffer, canonical);
      }

      ({ buffer, seq, batchCounter } = await this.flushBuffer({
        channel,
        buffer,
        seq,
        batchCounter,
        totalChunks,
        fileSize: file.size,
        state,
        metaId: meta.id,
      }));
    }

    if (state.cancelled) return;

    if (buffer.byteLength > 0 || seq < totalChunks - 1) {
      const remaining = new Uint8Array(buffer);
      await this.sendChunk(channel, meta.id, seq, totalChunks, file.size, remaining, true);
      seq += 1;
    } else {
      const lastChunkEmpty = new Uint8Array(0);
      await this.sendChunk(channel, meta.id, seq, totalChunks, file.size, lastChunkEmpty, true);
      seq += 1;
    }

    if (seq !== totalChunks) {
      throw new Error('transfer_chunks_mismatch');
    }

    if (channel.bufferedAmount >= this.opts.lowWaterMark) {
      const waitMs = await this.waitForBufferedLow(channel);
      this.tuneBatchSize(waitMs);
    }
  }

  private async flushBuffer(params: {
    channel: RTCDataChannel;
    buffer: Uint8Array<ArrayBufferLike>;
    seq: number;
    batchCounter: number;
    totalChunks: number;
    fileSize: number;
    state: SendState;
    metaId: string;
  }): Promise<{ buffer: Uint8Array<ArrayBufferLike>; seq: number; batchCounter: number }> {
    let { buffer, seq, batchCounter } = params;
    const { channel, totalChunks, fileSize, state, metaId } = params;

    while (buffer.byteLength >= this.opts.chunkSize && !state.cancelled) {
      const sliced = buffer.slice(0, this.opts.chunkSize);
      const chunk = new Uint8Array(sliced);
      buffer = buffer.slice(this.opts.chunkSize);
      // biome-ignore lint/performance/noAwaitInLoops: sequential ordering is required for RTC delivery
      await this.sendChunk(channel, metaId, seq, totalChunks, fileSize, chunk, false);
      seq += 1;
      batchCounter += 1;
      if (
        batchCounter >= this.currentBatchSize ||
        channel.bufferedAmount >= this.opts.lowWaterMark
      ) {
        const waitMs = await this.waitForBufferedLow(channel);
        this.tuneBatchSize(waitMs);
        batchCounter = 0;
      }
    }

    return { buffer, seq, batchCounter };
  }

  private concatUint8(a: Uint8Array, b: Uint8Array<ArrayBufferLike>): Uint8Array {
    const normalized = new Uint8Array(b.byteLength);
    normalized.set(b);
    if (a.byteLength === 0) return normalized;
    const out = new Uint8Array(a.byteLength + normalized.byteLength);
    out.set(a, 0);
    out.set(normalized, a.byteLength);
    return out;
  }

  private async sendChunk(
    channel: RTCDataChannel,
    id: string,
    seq: number,
    totalChunks: number,
    totalBytes: number,
    payload: Uint8Array,
    last: boolean,
  ): Promise<void> {
    const header = {
      version: VERSION,
      id,
      seq,
      totalChunks,
      totalBytes,
      chunkBytes: payload.byteLength,
      last,
    };
    const headerBytes = this.encoder.encode(JSON.stringify(header));
    const buffer = new ArrayBuffer(HEADER_BYTES + headerBytes.length + payload.byteLength);
    const view = new DataView(buffer);
    view.setUint32(0, headerBytes.length, false);
    new Uint8Array(buffer, HEADER_BYTES, headerBytes.length).set(headerBytes);
    const dest = new Uint8Array(buffer, HEADER_BYTES + headerBytes.length, payload.byteLength);
    const normalized = new Uint8Array(payload.byteLength);
    normalized.set(payload);
    dest.set(normalized);

    channel.send(buffer);
  }

  private waitForBufferedLow(
    channel: RTCDataChannel,
    opts?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const start = this.now();
      const threshold = this.opts.lowWaterMark >>> 0; // ensure non-negative
      channel.bufferedAmountLowThreshold = threshold;

      if (channel.bufferedAmount <= threshold) {
        resolve(0);
        return;
      }
      let settled = false;
      let fallbackId: number | undefined;
      let timeoutId: number | undefined;
      const settleOk = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(this.now() - start);
      };
      const settleErr = (e: unknown): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(e instanceof Error ? e : new Error(String(e)));
      };
      const handler = (_event?: Event): void => {
        if (channel.bufferedAmount <= threshold) settleOk();
      };
      const onCloseOrError = (_event?: Event): void => {
        if (channel.bufferedAmount <= threshold) settleOk();
        else settleErr(new Error('datachannel_closed'));
      };

      const onAbort = (_event?: Event): void =>
        settleErr(new DOMException('Aborted', 'AbortError'));
      const cleanup = (): void => {
        channel.removeEventListener('bufferedamountlow', handler);
        channel.removeEventListener('close', onCloseOrError);
        channel.removeEventListener('error', onCloseOrError);
        opts?.signal?.removeEventListener('abort', onAbort);
        if (fallbackId) clearInterval(fallbackId);
        if (timeoutId) clearTimeout(timeoutId);
      };

      channel.addEventListener('bufferedamountlow', handler, { once: true });
      channel.addEventListener('close', onCloseOrError, { once: true });
      channel.addEventListener('error', onCloseOrError, { once: true });
      fallbackId = setInterval(handler, 50) as unknown as number;
      if (opts?.timeoutMs && opts.timeoutMs > 0) {
        timeoutId = setTimeout(
          () => settleErr(new Error('buffer_low_timeout')),
          opts.timeoutMs,
        ) as unknown as number;
      }
      if (opts?.signal) {
        if (opts.signal.aborted) onAbort();
        else opts.signal.addEventListener('abort', onAbort, { once: true });
      }
      handler();
    });
  }

  private tuneBatchSize(waitMs: number): void {
    if (waitMs === 0) {
      this.currentBatchSize = Math.min(this.opts.maxBatchChunks, this.currentBatchSize + 1);
      return;
    }
    if (waitMs < this.opts.fastThresholdMs) {
      this.currentBatchSize = Math.min(this.opts.maxBatchChunks, this.currentBatchSize + 1);
    } else if (waitMs > this.opts.slowThresholdMs) {
      this.currentBatchSize = Math.max(this.opts.minBatchChunks, this.currentBatchSize - 1);
    }
  }

  private emit(event: TransferEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // ignore listener errors
      }
    }
  }

  private now(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }
}
