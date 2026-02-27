import type { ControlMsgWithoutProtocol, FileMetaMsg } from './protocol';
import { createTransferException, transferErrorCode } from './transfer-errors';
import {
  createTransferHashAccumulator,
  finalizeTransferHashAccumulator,
  isSameFileHash,
  isValidSha256Hex,
  normalizeHashValue,
  type TransferHashAccumulator,
  updateTransferHashAccumulator,
} from './transfer-hash';
import { type IncomingTimeoutState, TransferTimeoutManager } from './transfer-timeout-manager';
import type {
  DownloadToSinkHandle,
  FileDesc,
  FileHash,
  SessionState,
  TransferCancelReason,
  TransferFailureCode,
  TransferProgress,
  TransferTerminalEvent,
} from './types';

type IncomingTransferState = 'awaiting_meta' | 'receiving' | 'completed' | 'failed' | 'cancelled';

type IncomingTransfer = {
  transferId: string;
  fileId: string;
  state: IncomingTransferState;
  metaHint?: FileDesc;
  meta?: FileDesc;
  endSignalReceived: boolean;
  received: number;
  expectedSeq: number;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  writeChain: Promise<void>;
  bufferedBytes: number;
  finalizing: boolean;
  endHash?: FileHash;
  hashAccumulator: TransferHashAccumulator;
  onMeta?: (meta: FileDesc) => void;
  abort: AbortController;
  resolveDone: () => void;
  rejectDone: (error: unknown) => void;
} & IncomingTimeoutState;

type IncomingTransferManagerConfig = {
  maxConcurrentIncomingTransfers: number;
  maxBufferedIncomingBytes: number;
  metaTimeoutMs: number;
  idleTimeoutMs: number;
  hardTimeoutMs: number | null;
};

type IncomingTransferManagerDeps = {
  getState: () => SessionState;
  getCurrentMaxFileBytes: () => number;
  sendControl: (msg: ControlMsgWithoutProtocol) => Promise<void>;
  emitProgress: (event: TransferProgress) => void;
  emitTerminal: (event: TransferTerminalEvent) => void;
  emitTransferError: (
    transferId: string,
    code: TransferFailureCode,
    message: string,
    cause?: unknown,
  ) => void;
};

export class IncomingTransferManager {
  private readonly transferTimeouts: TransferTimeoutManager;
  private readonly incoming = new Map<string, IncomingTransfer>();
  private totalBufferedIncomingBytes = 0;
  private readonly cfg: IncomingTransferManagerConfig;
  private readonly deps: IncomingTransferManagerDeps;

  constructor(cfg: IncomingTransferManagerConfig, deps: IncomingTransferManagerDeps) {
    this.cfg = cfg;
    this.deps = deps;
    this.transferTimeouts = new TransferTimeoutManager({
      metaTimeoutMs: cfg.metaTimeoutMs,
      idleTimeoutMs: cfg.idleTimeoutMs,
      hardTimeoutMs: cfg.hardTimeoutMs,
    });
  }

  createDownload(
    transferId: string,
    fileId: string,
    peerFile: FileDesc | undefined,
    sink: WritableStream<Uint8Array>,
    opts?: { onMeta?: (meta: FileDesc) => void },
  ): DownloadToSinkHandle {
    if (this.deps.getState() === 'closed') {
      return {
        transferId,
        done: Promise.reject(createTransferException('RECV_FAILED', 'session is closed')),
        cancel: noop,
      };
    }

    if (!peerFile) {
      return {
        transferId,
        done: Promise.reject(
          createTransferException('NOT_FOUND', 'file not found in peer inventory'),
        ),
        cancel: noop,
      };
    }

    const maxFileBytes = this.deps.getCurrentMaxFileBytes();
    if (peerFile.size > maxFileBytes) {
      return {
        transferId,
        done: Promise.reject(
          createTransferException(
            'LIMIT_FILE_SIZE',
            `file exceeds maxFileBytes=${maxFileBytes} (got ${peerFile.size})`,
          ),
        ),
        cancel: noop,
      };
    }

    if (this.incoming.size >= this.cfg.maxConcurrentIncomingTransfers) {
      return {
        transferId,
        done: Promise.reject(
          createTransferException(
            'LIMIT_CONCURRENT_INCOMING',
            `too many incoming transfers (max ${this.cfg.maxConcurrentIncomingTransfers})`,
          ),
        ),
        cancel: noop,
      };
    }

    let writer: WritableStreamDefaultWriter<Uint8Array>;
    try {
      writer = sink.getWriter();
    } catch (error) {
      return {
        transferId,
        done: Promise.reject(
          createTransferException('SINK_WRITE_FAILED', 'failed to acquire sink writer', error),
        ),
        cancel: noop,
      };
    }

    let resolveDone!: () => void;
    let rejectDone!: (error: unknown) => void;
    const done = new Promise<void>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });

    const transfer: IncomingTransfer = {
      transferId,
      fileId,
      state: 'awaiting_meta',
      metaHint: peerFile,
      meta: undefined,
      endSignalReceived: false,
      received: 0,
      expectedSeq: 0,
      writer,
      writeChain: Promise.resolve(),
      bufferedBytes: 0,
      finalizing: false,
      endHash: undefined,
      hashAccumulator: createTransferHashAccumulator(),
      onMeta: opts?.onMeta,
      abort: new AbortController(),
      resolveDone,
      rejectDone,
    };

    this.incoming.set(transferId, transfer);
    this.armIncomingMetaTimeout(transfer);
    this.armIncomingHardTimeout(transfer);

    this.deps.emitProgress({
      dir: 'recv',
      transferId,
      fileId,
      done: 0,
      total: peerFile.size,
    });

    void this.deps.sendControl({ t: 'GET_FILE', transferId, fileId }).catch((error) => {
      this.failIncomingTransfer(
        transfer,
        'RECV_FAILED',
        'Failed to request file from peer',
        error,
        false,
      );
    });

    return {
      transferId,
      done,
      cancel: () => {
        this.cancelTransferById(transferId, 'USER_CANCELLED', 'cancelled by user');
      },
    };
  }

  handleIncomingMeta(transferId: string, meta: FileMetaMsg['file']): void {
    const transfer = this.incoming.get(transferId);
    if (!transfer || !this.isIncomingActive(transfer)) return;

    if (meta.id !== transfer.fileId) {
      this.failIncomingTransfer(
        transfer,
        'FILE_ID_MISMATCH',
        'file id mismatch in FILE_META',
        undefined,
        true,
      );
      return;
    }

    if (!Number.isFinite(meta.size) || meta.size < 0) {
      this.failIncomingTransfer(
        transfer,
        'PROTOCOL_VIOLATION',
        'invalid file size in FILE_META',
        undefined,
        true,
      );
      return;
    }

    const maxFileBytes = this.deps.getCurrentMaxFileBytes();
    if (meta.size > maxFileBytes) {
      this.failIncomingTransfer(
        transfer,
        'LIMIT_FILE_SIZE',
        `peer declared file larger than maxFileBytes=${maxFileBytes}`,
        undefined,
        true,
      );
      return;
    }

    if (transfer.received > meta.size) {
      this.failIncomingTransfer(
        transfer,
        'SIZE_OVERFLOW',
        `received bytes exceed declared size (${transfer.received} > ${meta.size})`,
        undefined,
        true,
      );
      return;
    }

    transfer.meta = {
      id: meta.id,
      name: meta.name,
      size: meta.size,
      mime: meta.mime,
      mtime: meta.mtime,
      hash: meta.hash,
    };

    transfer.state = 'receiving';
    this.transferTimeouts.clearIncomingMetaTimeout(transfer);
    this.armIncomingIdleTimeout(transfer);
    safeCall(() => transfer.onMeta?.(transfer.meta!));

    this.deps.emitProgress({
      dir: 'recv',
      transferId,
      fileId: transfer.fileId,
      done: transfer.received,
      total: transfer.meta.size,
    });

    this.tryFinalizeIncoming(transfer, 'FILE_META');
  }

  handleIncomingFileEnd(transferId: string, hash: FileHash | undefined): void {
    const transfer = this.incoming.get(transferId);
    if (!transfer || !this.isIncomingActive(transfer)) return;

    transfer.endHash = hash;
    transfer.endSignalReceived = true;
    this.armIncomingIdleTimeout(transfer);
    this.tryFinalizeIncoming(transfer, 'FILE_END');
  }

  handleIncomingData(transferId: string, seq: number, eof: boolean, payload: Uint8Array): void {
    const transfer = this.incoming.get(transferId);
    if (!transfer || !this.isIncomingActive(transfer)) return;

    if (transfer.state === 'awaiting_meta') {
      this.failIncomingTransfer(
        transfer,
        'PROTOCOL_VIOLATION',
        'received DATA before FILE_META',
        undefined,
        true,
      );
      return;
    }

    if (seq < transfer.expectedSeq) {
      return;
    }

    if (seq > transfer.expectedSeq) {
      this.failIncomingTransfer(
        transfer,
        'OUT_OF_ORDER',
        'out-of-order DATA frame sequence',
        undefined,
        true,
      );
      return;
    }

    const nextReceived = transfer.received + payload.length;
    const maxFileBytes = this.deps.getCurrentMaxFileBytes();
    if (nextReceived > maxFileBytes) {
      this.failIncomingTransfer(
        transfer,
        'LIMIT_FILE_SIZE',
        `received file exceeds maxFileBytes=${maxFileBytes}`,
        undefined,
        true,
      );
      return;
    }

    if (transfer.meta && nextReceived > transfer.meta.size) {
      this.failIncomingTransfer(
        transfer,
        'SIZE_OVERFLOW',
        `received bytes exceed declared size (${nextReceived} > ${transfer.meta.size})`,
        undefined,
        true,
      );
      return;
    }

    transfer.expectedSeq += 1;
    transfer.received = nextReceived;
    this.armIncomingIdleTimeout(transfer);

    if (payload.length > 0) {
      updateTransferHashAccumulator(transfer.hashAccumulator, payload);
      this.enqueueIncomingWrite(transfer, payload);
    }

    this.deps.emitProgress({
      dir: 'recv',
      transferId,
      fileId: transfer.fileId,
      done: transfer.received,
      total: transfer.meta?.size ?? transfer.metaHint?.size ?? 0,
    });

    if (eof) {
      transfer.endSignalReceived = true;
      this.tryFinalizeIncoming(transfer, 'EOF_FLAG');
    }
  }

  failTransferById(
    transferId: string,
    code: TransferFailureCode,
    message: string,
    cause: unknown,
    notifyPeer: boolean,
  ): boolean {
    const transfer = this.incoming.get(transferId);
    if (!transfer) {
      return false;
    }

    this.failIncomingTransfer(transfer, code, message, cause, notifyPeer);
    return true;
  }

  cancelTransferById(transferId: string, reason: TransferCancelReason, message: string): boolean {
    const transfer = this.incoming.get(transferId);
    if (!transfer) {
      return false;
    }

    this.cancelIncomingTransfer(transfer, reason, message);
    return true;
  }

  closeAll(reason: string, transferCancelReason: TransferCancelReason): void {
    const incomingTransfers = Array.from(this.incoming.values());
    for (const transfer of incomingTransfers) {
      this.cancelIncomingTransfer(transfer, transferCancelReason, reason);
    }
    this.totalBufferedIncomingBytes = 0;
  }

  private enqueueIncomingWrite(transfer: IncomingTransfer, payload: Uint8Array): void {
    const size = payload.length;

    if (this.totalBufferedIncomingBytes + size > this.cfg.maxBufferedIncomingBytes) {
      this.failIncomingTransfer(
        transfer,
        'LIMIT_BUFFERED_BYTES',
        `incoming buffered bytes exceed maxBufferedIncomingBytes=${this.cfg.maxBufferedIncomingBytes}`,
        undefined,
        true,
      );
      return;
    }

    const chunk = payload.slice();
    this.totalBufferedIncomingBytes += size;
    transfer.bufferedBytes += size;

    transfer.writeChain = transfer.writeChain
      .then(async () => {
        if (!this.isIncomingActive(transfer)) return;
        await transfer.writer.write(chunk);
      })
      .catch((error) => {
        if (this.isIncomingActive(transfer)) {
          this.failIncomingTransfer(
            transfer,
            transferErrorCode(error, 'SINK_WRITE_FAILED'),
            'failed to write incoming data to sink',
            error,
            true,
          );
        }
      })
      .finally(() => {
        transfer.bufferedBytes = Math.max(0, transfer.bufferedBytes - size);
        this.totalBufferedIncomingBytes = Math.max(0, this.totalBufferedIncomingBytes - size);
        this.tryFinalizeIncoming(transfer, 'WRITE_FLUSH');
      });
  }

  private tryFinalizeIncoming(transfer: IncomingTransfer, source: string): void {
    if (!this.isIncomingActive(transfer)) return;
    if (transfer.finalizing) return;
    if (!transfer.endSignalReceived) return;
    if (!transfer.meta) return;

    if (transfer.received !== transfer.meta.size) {
      this.failIncomingTransfer(
        transfer,
        'SIZE_MISMATCH',
        `transfer ended with size mismatch at ${source} (got ${transfer.received}, expected ${transfer.meta.size})`,
        undefined,
        true,
      );
      return;
    }

    transfer.finalizing = true;

    void transfer.writeChain
      .then(async () => {
        if (!this.isIncomingActive(transfer)) return;
        if (!this.verifyIncomingTransferHash(transfer)) return;
        await transfer.writer.close();
        this.completeIncomingTransfer(transfer);
      })
      .catch((error) => {
        if (this.isIncomingActive(transfer)) {
          this.failIncomingTransfer(
            transfer,
            transferErrorCode(error, 'SINK_WRITE_FAILED'),
            'failed to finalize incoming sink',
            error,
            true,
          );
        }
      });
  }

  private verifyIncomingTransferHash(transfer: IncomingTransfer): boolean {
    const endHash = transfer.endHash;
    if (!endHash) {
      this.failIncomingTransfer(
        transfer,
        'PROTOCOL_VIOLATION',
        'missing FILE_END hash',
        undefined,
        true,
      );
      return false;
    }

    if (!isValidSha256Hex(endHash.value)) {
      this.failIncomingTransfer(
        transfer,
        'PROTOCOL_VIOLATION',
        'invalid SHA-256 hash format in FILE_END',
        undefined,
        true,
      );
      return false;
    }

    const computedHash = finalizeTransferHashAccumulator(transfer.hashAccumulator);
    if (!isSameFileHash(computedHash, endHash)) {
      this.failIncomingTransfer(
        transfer,
        'HASH_MISMATCH',
        `hash mismatch: expected ${normalizeHashValue(endHash.value)}, got ${computedHash.value}`,
        undefined,
        true,
      );
      return false;
    }

    if (transfer.meta) {
      transfer.meta = {
        ...transfer.meta,
        hash: computedHash,
      };
    }

    return true;
  }

  private completeIncomingTransfer(transfer: IncomingTransfer): void {
    if (!this.isIncomingActive(transfer)) return;

    transfer.state = 'completed';
    this.clearIncomingTimers(transfer);
    this.incoming.delete(transfer.transferId);

    try {
      transfer.writer.releaseLock();
    } catch {}

    transfer.resolveDone();
    this.deps.emitProgress({
      dir: 'recv',
      transferId: transfer.transferId,
      fileId: transfer.fileId,
      done: transfer.received,
      total: transfer.meta?.size ?? transfer.received,
    });

    this.deps.emitTerminal({
      dir: 'recv',
      transferId: transfer.transferId,
      fileId: transfer.fileId,
      status: 'completed',
      done: transfer.received,
      total: transfer.meta?.size ?? transfer.received,
    });
  }

  private failIncomingTransfer(
    transfer: IncomingTransfer,
    code: TransferFailureCode,
    message: string,
    cause: unknown,
    notifyPeer: boolean,
  ): void {
    if (!this.isIncomingActive(transfer)) return;

    transfer.state = 'failed';
    this.clearIncomingTimers(transfer);
    this.incoming.delete(transfer.transferId);

    const error = createTransferException(code, message, cause);
    void transfer.writer.abort(error).catch(noop);
    try {
      transfer.writer.releaseLock();
    } catch {}

    transfer.rejectDone(error);
    this.deps.emitTransferError(transfer.transferId, code, message, cause);
    this.deps.emitTerminal({
      dir: 'recv',
      transferId: transfer.transferId,
      fileId: transfer.fileId,
      status: 'failed',
      code,
      message,
      cause,
      done: transfer.received,
      total: transfer.meta?.size ?? transfer.metaHint?.size ?? 0,
    });

    if (notifyPeer) {
      void this.sendTransferError(transfer.transferId, code, message);
    }
  }

  private cancelIncomingTransfer(
    transfer: IncomingTransfer,
    reason: TransferCancelReason,
    message: string,
  ): void {
    if (!this.isIncomingActive(transfer)) return;

    transfer.state = 'cancelled';
    this.clearIncomingTimers(transfer);
    this.incoming.delete(transfer.transferId);

    const error = new Error(message);
    transfer.abort.abort(error);
    void transfer.writer.abort(error).catch(noop);

    try {
      transfer.writer.releaseLock();
    } catch {}

    transfer.rejectDone(error);
    this.deps.emitTerminal({
      dir: 'recv',
      transferId: transfer.transferId,
      fileId: transfer.fileId,
      status: 'cancelled',
      reason,
      message,
      done: transfer.received,
      total: transfer.meta?.size ?? transfer.metaHint?.size ?? 0,
    });
  }

  private isIncomingActive(transfer: IncomingTransfer): boolean {
    return transfer.state === 'awaiting_meta' || transfer.state === 'receiving';
  }

  private armIncomingMetaTimeout(transfer: IncomingTransfer): void {
    this.transferTimeouts.armIncomingMetaTimeout(transfer, () => {
      this.failIncomingTransfer(
        transfer,
        'META_TIMEOUT',
        `did not receive FILE_META within ${this.cfg.metaTimeoutMs}ms`,
        undefined,
        true,
      );
    });
  }

  private armIncomingIdleTimeout(transfer: IncomingTransfer): void {
    if (!this.isIncomingActive(transfer)) return;
    this.transferTimeouts.armIncomingIdleTimeout(transfer, () => {
      this.failIncomingTransfer(
        transfer,
        'IDLE_TIMEOUT',
        `incoming transfer idle timeout (${this.cfg.idleTimeoutMs}ms)`,
        undefined,
        true,
      );
    });
  }

  private armIncomingHardTimeout(transfer: IncomingTransfer): void {
    this.transferTimeouts.armIncomingHardTimeout(transfer, () => {
      this.failIncomingTransfer(
        transfer,
        'HARD_TIMEOUT',
        `incoming transfer hard timeout (${this.cfg.hardTimeoutMs}ms)`,
        undefined,
        true,
      );
    });
  }

  private clearIncomingTimers(transfer: IncomingTransfer): void {
    this.transferTimeouts.clearIncomingTimeouts(transfer);
  }

  private async sendTransferError(
    transferId: string,
    code: TransferFailureCode,
    message: string,
  ): Promise<void> {
    try {
      await this.deps.sendControl({
        t: 'ERROR',
        scope: 'transfer',
        transferId,
        code,
        message,
      });
    } catch {
      // best effort
    }
  }
}

function safeCall(fn: (() => void) | undefined): void {
  if (!fn) return;
  try {
    fn();
  } catch {
    // ignore callback errors
  }
}

function noop(): void {}
