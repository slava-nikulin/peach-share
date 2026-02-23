import type { ControlMsgWithoutProtocol } from './protocol';
import type { NegotiatedSessionSettings } from './session-negotiation';
import { TransferTimeoutManager, type OutgoingTimeoutState } from './transfer-timeout-manager';
import {
  createTransferHashAccumulator,
  finalizeTransferHashAccumulator,
  type TransferHashAccumulator,
  updateTransferHashAccumulator,
} from './transfer-hash';
import { createTransferException, transferErrorCode } from './transfer-errors';
import type {
  SessionErrorCode,
  SessionState,
  TransferCancelReason,
  TransferFailureCode,
  TransferProgress,
  TransferTerminalEvent,
} from './types';
import { encodeDataWire, transferIdTo16 } from './wire';

type OutgoingTransferState = 'sending' | 'completed' | 'failed' | 'cancelled';

type PendingOutgoingRequest = {
  transferId: string;
  fileId: string;
};

type OutgoingTransfer = {
  transferId: string;
  transferId16: Uint8Array;
  fileId: string;
  file: File;
  state: OutgoingTransferState;
  sent: number;
  total: number;
  nextSeq: number;
  chunkBytes: number;
  hashAccumulator: TransferHashAccumulator;
  abort: AbortController;
} & OutgoingTimeoutState;

type OutgoingTransferManagerConfig = {
  maxConcurrentOutgoingTransfers: number;
  idleTimeoutMs: number;
  hardTimeoutMs: number | null;
};

type OutgoingTransferManagerDeps = {
  getState: () => SessionState;
  getCurrentMaxFileBytes: () => number;
  getNegotiatedSettings: () => NegotiatedSessionSettings;
  getLocalFile: (fileId: string) => File | undefined;
  sendControl: (msg: ControlMsgWithoutProtocol) => Promise<void>;
  sendDataWire: (wire: Uint8Array) => Promise<void>;
  emitProgress: (event: TransferProgress) => void;
  emitTerminal: (event: TransferTerminalEvent) => void;
  emitTransferError: (
    transferId: string,
    code: TransferFailureCode,
    message: string,
    cause?: unknown,
  ) => void;
  emitSessionError: (code: SessionErrorCode, message: string, cause?: unknown) => void;
};

export class OutgoingTransferManager {
  private readonly transferTimeouts: TransferTimeoutManager;
  private readonly outgoing = new Map<string, OutgoingTransfer>();
  private readonly pendingOutgoingQueue: PendingOutgoingRequest[] = [];
  private readonly pendingOutgoingById = new Map<string, PendingOutgoingRequest>();
  private activeOutgoingCount = 0;

  constructor(
    private readonly cfg: OutgoingTransferManagerConfig,
    private readonly deps: OutgoingTransferManagerDeps,
  ) {
    this.transferTimeouts = new TransferTimeoutManager({
      metaTimeoutMs: 1,
      idleTimeoutMs: cfg.idleTimeoutMs,
      hardTimeoutMs: cfg.hardTimeoutMs,
    });
  }

  enqueueOutgoingSend(transferId: string, fileId: string): void {
    if (this.deps.getState() === 'closed') return;
    if (this.outgoing.has(transferId) || this.pendingOutgoingById.has(transferId)) return;

    const activeAndQueued = this.outgoing.size + this.pendingOutgoingById.size;
    if (activeAndQueued >= this.cfg.maxConcurrentOutgoingTransfers) {
      void this.sendTransferError(
        transferId,
        'LIMIT_CONCURRENT_OUTGOING',
        `too many outgoing transfers (max ${this.cfg.maxConcurrentOutgoingTransfers})`,
      );
      return;
    }

    const request: PendingOutgoingRequest = { transferId, fileId };
    this.pendingOutgoingById.set(transferId, request);
    this.pendingOutgoingQueue.push(request);
    this.drainOutgoingQueue();
  }

  failTransferById(
    transferId: string,
    code: TransferFailureCode,
    message: string,
    cause: unknown,
    notifyPeer: boolean,
  ): boolean {
    const transfer = this.outgoing.get(transferId);
    if (transfer) {
      this.failOutgoingTransfer(transfer, code, message, cause, notifyPeer);
      return true;
    }

    const pending = this.pendingOutgoingById.get(transferId);
    if (!pending) {
      return false;
    }

    this.removePendingOutgoing(transferId);
    this.deps.emitTerminal({
      dir: 'send',
      transferId,
      fileId: pending.fileId,
      status: 'failed',
      code,
      message,
      cause,
      done: 0,
      total: 0,
    });
    this.deps.emitTransferError(transferId, code, message, cause);

    if (notifyPeer) {
      void this.sendTransferError(transferId, code, message);
    }
    return true;
  }

  cancelTransferById(
    transferId: string,
    reason: TransferCancelReason,
    message: string,
  ): boolean {
    let affected = false;

    const transfer = this.outgoing.get(transferId);
    if (transfer) {
      this.cancelOutgoingTransfer(transfer, reason, message);
      affected = true;
    }

    const pending = this.pendingOutgoingById.get(transferId);
    if (pending) {
      this.removePendingOutgoing(transferId);
      this.deps.emitTerminal({
        dir: 'send',
        transferId,
        fileId: pending.fileId,
        status: 'cancelled',
        reason,
        message,
        done: 0,
        total: 0,
      });
      affected = true;
    }

    return affected;
  }

  closeAll(reason: string, transferCancelReason: TransferCancelReason): void {
    const outgoingTransfers = Array.from(this.outgoing.values());
    for (const transfer of outgoingTransfers) {
      this.cancelOutgoingTransfer(transfer, transferCancelReason, reason);
    }

    const pending = Array.from(this.pendingOutgoingById.values());
    for (const request of pending) {
      this.removePendingOutgoing(request.transferId);
      this.deps.emitTerminal({
        dir: 'send',
        transferId: request.transferId,
        fileId: request.fileId,
        status: 'cancelled',
        reason: transferCancelReason,
        message: reason,
        done: 0,
        total: 0,
      });
    }
  }

  private drainOutgoingQueue(): void {
    while (this.activeOutgoingCount < this.cfg.maxConcurrentOutgoingTransfers) {
      const next = this.pendingOutgoingQueue.shift();
      if (!next) return;

      this.pendingOutgoingById.delete(next.transferId);
      this.activeOutgoingCount += 1;

      void this.runOutgoingTransfer(next.transferId, next.fileId).finally(() => {
        this.activeOutgoingCount = Math.max(0, this.activeOutgoingCount - 1);
        this.drainOutgoingQueue();
      });
    }
  }

  private async runOutgoingTransfer(transferId: string, fileId: string): Promise<void> {
    const file = this.deps.getLocalFile(fileId);
    if (!file) {
      await this.sendTransferError(transferId, 'NOT_FOUND', 'file not found');
      return;
    }

    const maxFileBytes = this.deps.getCurrentMaxFileBytes();
    if (file.size > maxFileBytes) {
      await this.sendTransferError(
        transferId,
        'LIMIT_FILE_SIZE',
        `file exceeds maxFileBytes=${maxFileBytes} (got ${file.size})`,
      );
      return;
    }

    let transferId16: Uint8Array;
    try {
      transferId16 = transferIdTo16(transferId);
    } catch (error) {
      this.deps.emitSessionError('PROTOCOL_VIOLATION', 'invalid transfer id in GET_FILE', error);
      await this.sendTransferError(transferId, 'INVALID_TRANSFER_ID', 'invalid transfer id');
      return;
    }

    const transfer: OutgoingTransfer = {
      transferId,
      transferId16,
      fileId,
      file,
      state: 'sending',
      sent: 0,
      total: file.size,
      nextSeq: 0,
      chunkBytes: this.deps.getNegotiatedSettings().chunkBytes,
      hashAccumulator: createTransferHashAccumulator(),
      abort: new AbortController(),
    };

    this.outgoing.set(transferId, transfer);
    this.armOutgoingIdleTimeout(transfer);
    this.armOutgoingHardTimeout(transfer);

    this.deps.emitProgress({ dir: 'send', transferId, fileId, done: 0, total: transfer.total });

    try {
      await this.deps.sendControl({
        t: 'FILE_META',
        transferId,
        file: {
          id: fileId,
          name: file.name,
          size: file.size,
          mime: file.type || 'application/octet-stream',
          mtime: Number.isFinite(file.lastModified) ? file.lastModified : undefined,
        },
      });

      this.armOutgoingIdleTimeout(transfer);
      await this.sendOutgoingFileChunks(transfer);

      if (this.isOutgoingActive(transfer)) {
        const endHash = finalizeTransferHashAccumulator(transfer.hashAccumulator);
        await this.deps.sendControl({
          t: 'FILE_END',
          transferId,
          hash: endHash,
        });
        this.armOutgoingIdleTimeout(transfer);
        this.completeOutgoingTransfer(transfer);
      }
    } catch (error) {
      if (!this.isOutgoingActive(transfer)) {
        return;
      }

      this.failOutgoingTransfer(
        transfer,
        transferErrorCode(error, 'SEND_FAILED'),
        'send failed',
        error,
        true,
      );
    }
  }

  private async sendOutgoingFileChunks(transfer: OutgoingTransfer): Promise<void> {
    const reader = (transfer.file.stream() as ReadableStream<Uint8Array>).getReader();
    const cancelReaderOnAbort = (): void => {
      void reader.cancel(transfer.abort.signal.reason).catch(noop);
    };

    transfer.abort.signal.addEventListener('abort', cancelReaderOnAbort, { once: true });

    try {
      while (this.isOutgoingActive(transfer)) {
        const { value, done } = await readWithAbort(reader, transfer.abort.signal);
        if (done) break;
        if (!value || value.length === 0) continue;

        for (const payload of chunkUint8Array(value, transfer.chunkBytes)) {
          if (!this.isOutgoingActive(transfer)) {
            throw createTransferException('SEND_FAILED', 'outgoing transfer aborted');
          }

          const wire = encodeDataWire({
            transferId16: transfer.transferId16,
            seq: transfer.nextSeq,
            eof: false,
            payload,
          });

          const negotiated = this.deps.getNegotiatedSettings();
          if (wire.length > negotiated.maxMessageBytes) {
            throw createTransferException(
              'SEND_FAILED',
              `DATA message exceeds negotiated maxMessageBytes=${negotiated.maxMessageBytes} (got ${wire.length})`,
            );
          }

          await this.deps.sendDataWire(wire);
          updateTransferHashAccumulator(transfer.hashAccumulator, payload);

          transfer.nextSeq += 1;
          transfer.sent += payload.length;
          this.armOutgoingIdleTimeout(transfer);

          this.deps.emitProgress({
            dir: 'send',
            transferId: transfer.transferId,
            fileId: transfer.fileId,
            done: transfer.sent,
            total: transfer.total,
          });
        }
      }
    } finally {
      transfer.abort.signal.removeEventListener('abort', cancelReaderOnAbort);

      if (!this.isOutgoingActive(transfer) || transfer.abort.signal.aborted) {
        try {
          await reader.cancel(transfer.abort.signal.reason);
        } catch {}
      }

      try {
        reader.releaseLock();
      } catch {}
    }
  }

  private completeOutgoingTransfer(transfer: OutgoingTransfer): void {
    if (!this.isOutgoingActive(transfer)) return;

    transfer.state = 'completed';
    this.clearOutgoingTimers(transfer);
    this.outgoing.delete(transfer.transferId);

    this.deps.emitProgress({
      dir: 'send',
      transferId: transfer.transferId,
      fileId: transfer.fileId,
      done: transfer.total,
      total: transfer.total,
    });

    this.deps.emitTerminal({
      dir: 'send',
      transferId: transfer.transferId,
      fileId: transfer.fileId,
      status: 'completed',
      done: transfer.total,
      total: transfer.total,
    });
  }

  private failOutgoingTransfer(
    transfer: OutgoingTransfer,
    code: TransferFailureCode,
    message: string,
    cause: unknown,
    notifyPeer: boolean,
  ): void {
    if (!this.isOutgoingActive(transfer)) return;

    transfer.state = 'failed';
    transfer.abort.abort(createTransferException(code, message, cause));

    this.clearOutgoingTimers(transfer);
    this.outgoing.delete(transfer.transferId);

    this.deps.emitTransferError(transfer.transferId, code, message, cause);
    this.deps.emitTerminal({
      dir: 'send',
      transferId: transfer.transferId,
      fileId: transfer.fileId,
      status: 'failed',
      code,
      message,
      cause,
      done: transfer.sent,
      total: transfer.total,
    });

    if (notifyPeer) {
      void this.sendTransferError(transfer.transferId, code, message);
    }
  }

  private cancelOutgoingTransfer(
    transfer: OutgoingTransfer,
    reason: TransferCancelReason,
    message: string,
  ): void {
    if (!this.isOutgoingActive(transfer)) return;

    transfer.state = 'cancelled';
    transfer.abort.abort(new Error(message));

    this.clearOutgoingTimers(transfer);
    this.outgoing.delete(transfer.transferId);

    this.deps.emitTerminal({
      dir: 'send',
      transferId: transfer.transferId,
      fileId: transfer.fileId,
      status: 'cancelled',
      reason,
      message,
      done: transfer.sent,
      total: transfer.total,
    });
  }

  private isOutgoingActive(transfer: OutgoingTransfer): boolean {
    return transfer.state === 'sending';
  }

  private removePendingOutgoing(transferId: string): void {
    if (!this.pendingOutgoingById.has(transferId)) return;

    this.pendingOutgoingById.delete(transferId);
    const index = this.pendingOutgoingQueue.findIndex((item) => item.transferId === transferId);
    if (index >= 0) {
      this.pendingOutgoingQueue.splice(index, 1);
    }
  }

  private armOutgoingIdleTimeout(transfer: OutgoingTransfer): void {
    if (!this.isOutgoingActive(transfer)) return;
    this.transferTimeouts.armOutgoingIdleTimeout(transfer, () => {
      this.failOutgoingTransfer(
        transfer,
        'IDLE_TIMEOUT',
        `outgoing transfer idle timeout (${this.cfg.idleTimeoutMs}ms)`,
        undefined,
        true,
      );
    });
  }

  private armOutgoingHardTimeout(transfer: OutgoingTransfer): void {
    this.transferTimeouts.armOutgoingHardTimeout(transfer, () => {
      this.failOutgoingTransfer(
        transfer,
        'HARD_TIMEOUT',
        `outgoing transfer hard timeout (${this.cfg.hardTimeoutMs}ms)`,
        undefined,
        true,
      );
    });
  }

  private clearOutgoingTimers(transfer: OutgoingTransfer): void {
    this.transferTimeouts.clearOutgoingTimeouts(transfer);
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

async function readWithAbort<T>(
  reader: ReadableStreamDefaultReader<T>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<T>> {
  if (signal.aborted) {
    throw abortReasonToError(signal.reason);
  }

  let onAbort: (() => void) | undefined;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(abortReasonToError(signal.reason));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

  try {
    return await Promise.race([reader.read(), abortPromise]);
  } finally {
    if (onAbort) {
      signal.removeEventListener('abort', onAbort);
    }
  }
}

function abortReasonToError(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }

  if (typeof reason === 'string' && reason.length > 0) {
    return new Error(reason);
  }

  return new Error('aborted');
}

function* chunkUint8Array(chunk: Uint8Array, maxChunkBytes: number): Iterable<Uint8Array> {
  if (chunk.length <= maxChunkBytes) {
    yield chunk;
    return;
  }

  let offset = 0;
  while (offset < chunk.length) {
    const end = Math.min(offset + maxChunkBytes, chunk.length);
    yield chunk.subarray(offset, end);
    offset = end;
  }
}

function noop(): void {}
