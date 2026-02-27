import type { P2pChannel } from '../../../../bll/ports/p2p-channel';
import { createJsonCodec } from './codec';
import { IncomingTransferManager } from './incoming-transfer-manager';
import { InventorySyncManager } from './inventory-sync-manager';
import { MessageTransport } from './message-transport';
import { OutgoingTransferManager } from './outgoing-transfer-manager';
import { resolveConfig, type FileExchangeConfig, type ResolvedConfig } from './session-config';
import {
  type ControlMsg,
  type ControlMsgWithoutProtocol,
  type FileMetaMsg,
  type HelloMsg,
  type Protocol,
} from './protocol';
import {
  buildLocalHelloMessage,
  buildLocalHelloCapabilities,
  createDefaultNegotiatedSessionSettings,
  isSameNegotiatedSessionSettings,
  type NegotiatedSessionSettings,
  type NegotiationState,
  negotiateSessionFromHello,
} from './session-negotiation';
import { createInMemorySinkWriter } from './sink-writer-adapter';
import { createTransferException } from './transfer-errors';
import type {
  DownloadHandle,
  DownloadToSinkHandle,
  FileDesc,
  FileHash,
  FileExchangeSession,
  SessionError,
  SessionErrorCode,
  SessionState,
  TransferCancelReason,
  TransferFailureCode,
  TransferProgress,
  TransferTerminalEvent,
} from './types';
import {
  bytes16ToB64u,
  decodeWire,
  encodeControlWire,
  newId16,
  transferIdFrom16,
} from './wire';

type IntervalHandle = ReturnType<typeof setInterval>;

/**
 * Builder/factory for FileExchangeSession bound to an established P2pChannel.
 */
export class FileExchangeSessionBuilder {
  private readonly channel: P2pChannel;
  private readonly config: FileExchangeConfig;

  constructor(channel: P2pChannel, config: FileExchangeConfig = {}) {
    this.channel = channel;
    this.config = config;
  }

  build(): FileExchangeSession {
    return new FileExchangeSessionImpl(this.channel, resolveConfig(this.config));
  }
}

class FileExchangeSessionImpl implements FileExchangeSession {
  private readonly channel: P2pChannel;
  private readonly cfg: ResolvedConfig;

  private stateValue: SessionState = 'ready';

  private readonly stateEmitter = createEmitter<SessionState>();
  private readonly localEmitter = createEmitter<readonly FileDesc[]>();
  private readonly peerEmitter = createEmitter<readonly FileDesc[]>();
  private readonly progressEmitter = createEmitter<TransferProgress>();
  private readonly terminalEmitter = createEmitter<TransferTerminalEvent>();
  private readonly errorEmitter = createEmitter<SessionError>();

  private readonly codec: ReturnType<typeof createJsonCodec>;
  private readonly transport: MessageTransport;

  private readonly localStore = new Map<string, File>();
  private localIndex: FileDesc[] = [];
  private peerIndex: FileDesc[] = [];

  private readonly sessionId = createId();
  private readonly localHelloCapabilities: ReturnType<typeof buildLocalHelloCapabilities>;
  private negotiation: NegotiationState;
  private readonly inventorySync: InventorySyncManager;
  private readonly incomingTransfers: IncomingTransferManager;
  private readonly outgoingTransfers: OutgoingTransferManager;
  private inventoryResendTimer?: IntervalHandle;

  private readonly unsubTransportMessage: () => void;
  private readonly unsubChannelClose: () => void;

  constructor(channel: P2pChannel, cfg: ResolvedConfig) {
    this.channel = channel;
    this.cfg = cfg;
    this.localHelloCapabilities = buildLocalHelloCapabilities(this.cfg);
    this.negotiation = {
      status: 'pending',
      settings: createDefaultNegotiatedSessionSettings(this.cfg),
    };

    this.codec = createJsonCodec({ maxBytes: this.cfg.controlMaxBytes });
    this.transport = new MessageTransport(this.channel, {
      maxFrameBytes: this.cfg.transportMaxFrameBytes,
      maxMessageBytes: this.cfg.transportMaxMessageBytes,
      yieldEveryFrames: 8,
      onTransportError: (error) => this.handleTransportError(error),
    });

    this.unsubTransportMessage = this.transport.onMessage(this.handleInboundMessage);
    this.unsubChannelClose = this.channel.onClose(() => {
      this.closeSession('channel closed', false, 'SESSION_CLOSED');
    });

    this.inventorySync = new InventorySyncManager({
      getState: () => this.stateValue,
      getLocalFiles: () => this.localIndex,
      getPeerFiles: () => this.peerIndex,
      setPeerFiles: (files) => {
        this.peerIndex = files.slice();
        this.peerEmitter.emit(this.peerIndex);
      },
      sendControl: (msg) => this.sendControl(msg),
      canSendControlMessage: (msg) => this.canSendControlMessage(msg),
      emitSessionError: (code, message, cause) => this.emitSessionError(code, message, cause),
      onPeerSnapshotReceived: () => this.stopInventoryResend(),
      createId,
    });
    this.incomingTransfers = new IncomingTransferManager(
      {
        maxConcurrentIncomingTransfers: this.cfg.maxConcurrentIncomingTransfers,
        maxBufferedIncomingBytes: this.cfg.maxBufferedIncomingBytes,
        metaTimeoutMs: this.cfg.metaTimeoutMs,
        idleTimeoutMs: this.cfg.idleTimeoutMs,
        hardTimeoutMs: this.cfg.hardTimeoutMs,
      },
      {
        getState: () => this.stateValue,
        getCurrentMaxFileBytes: () => this.currentMaxFileBytes(),
        sendControl: (msg) => this.sendControl(msg),
        emitProgress: (event) => this.progressEmitter.emit(event),
        emitTerminal: (event) => this.terminalEmitter.emit(event),
        emitTransferError: (transferId, code, message, cause) =>
          this.emitTransferError(transferId, code, message, cause),
      },
    );
    this.outgoingTransfers = new OutgoingTransferManager(
      {
        maxConcurrentOutgoingTransfers: this.cfg.maxConcurrentOutgoingTransfers,
        idleTimeoutMs: this.cfg.idleTimeoutMs,
        hardTimeoutMs: this.cfg.hardTimeoutMs,
      },
      {
        getState: () => this.stateValue,
        getCurrentMaxFileBytes: () => this.currentMaxFileBytes(),
        getNegotiatedSettings: () => this.currentNegotiatedSettings(),
        getLocalFile: (fileId) => this.localStore.get(fileId),
        sendControl: (msg) => this.sendControl(msg),
        sendDataWire: (wire) => this.transport.sendMessage(wire, { priority: 'data' }),
        emitProgress: (event) => this.progressEmitter.emit(event),
        emitTerminal: (event) => this.terminalEmitter.emit(event),
        emitTransferError: (transferId, code, message, cause) =>
          this.emitTransferError(transferId, code, message, cause),
        emitSessionError: (code, message, cause) => this.emitSessionError(code, message, cause),
      },
    );

    this.sendHelloAndSnapshot();
    this.inventoryResendTimer = setInterval(() => {
      if (this.stateValue === 'closed') return;
      if (this.inventorySync.hasPeerSnapshotReceived()) return;
      this.sendHelloAndSnapshot();
    }, this.cfg.inventoryResendIntervalMs);
  }

  state(): SessionState {
    return this.stateValue;
  }

  onStateChanged(cb: (s: SessionState) => void): () => void {
    const unsub = this.stateEmitter.subscribe(cb);
    safeCall(() => cb(this.stateValue));
    return unsub;
  }

  dispose(): void {
    this.closeSession('disposed', true, 'DISPOSED');
  }

  async addLocal(files: FileList | File[]): Promise<void> {
    if (this.stateValue === 'closed') {
      throw createTransferException('RECV_FAILED', 'session is closed');
    }

    const list = normalizeFiles(files);
    if (list.length === 0) return;

    const maxFileBytes = this.currentMaxFileBytes();
    const added: FileDesc[] = [];
    for (const file of list) {
      if (file.size > maxFileBytes) {
        throw createTransferException(
          'LIMIT_FILE_SIZE',
          `file exceeds maxFileBytes=${maxFileBytes} (got ${file.size})`,
        );
      }

      const id = createId();
      this.localStore.set(id, file);
      added.push(fileToDesc(id, file));
    }

    this.localIndex = this.localIndex.concat(added);
    this.localEmitter.emit(this.localIndex);

    this.inventorySync.enqueueLocalInventoryDelta({ add: added });
    try {
      await this.inventorySync.flushLocalInventoryDeltasSoon();
    } catch (error) {
      this.emitSessionError('INVENTORY_SYNC_FAILED', 'Failed to publish local inventory changes', error);
      throw error;
    }
  }

  unshare(fileId: string): void {
    if (!this.localStore.has(fileId)) return;

    this.localStore.delete(fileId);
    this.localIndex = this.localIndex.filter((file) => file.id !== fileId);
    this.localEmitter.emit(this.localIndex);

    this.inventorySync.enqueueLocalInventoryDelta({ remove: [fileId] });
    void this.inventorySync.flushLocalInventoryDeltasSoon().catch((error) => {
      this.emitSessionError('INVENTORY_SYNC_FAILED', 'Failed to sync unshare with peer', error);
    });
  }

  localFiles(): readonly FileDesc[] {
    return this.localIndex;
  }

  onLocalFilesChanged(cb: (files: readonly FileDesc[]) => void): () => void {
    const unsub = this.localEmitter.subscribe(cb);
    safeCall(() => cb(this.localIndex));
    return unsub;
  }

  peerFiles(): readonly FileDesc[] {
    return this.peerIndex;
  }

  onPeerFilesChanged(cb: (files: readonly FileDesc[]) => void): () => void {
    const unsub = this.peerEmitter.subscribe(cb);
    safeCall(() => cb(this.peerIndex));
    return unsub;
  }

  requestDownload(fileId: string): DownloadHandle {
    let mimeHint = this.peerIndex.find((file) => file.id === fileId)?.mime || 'application/octet-stream';

    const memorySink = createInMemorySinkWriter(this.currentMaxFileBytes(), createTransferException);
    const handle = this.requestDownloadToInternal(fileId, memorySink.sink, {
      onMeta: (meta) => {
        mimeHint = meta.mime;
      },
    });

    return {
      transferId: handle.transferId,
      result: handle.done
        .then(() => memorySink.toBlob(mimeHint))
        .finally(() => {
          memorySink.clear();
        }),
      cancel: handle.cancel,
    };
  }

  requestDownloadTo(fileId: string, sink: WritableStream<Uint8Array>): DownloadToSinkHandle {
    return this.requestDownloadToInternal(fileId, sink);
  }

  cancelTransfer(transferId: string): void {
    this.cancelTransferInternal(transferId, {
      reason: 'USER_CANCELLED',
      message: 'cancelled by user',
      notifyPeer: true,
    });
  }

  onTransferProgress(cb: (p: TransferProgress) => void): () => void {
    return this.progressEmitter.subscribe(cb);
  }

  onTransferTerminal(cb: (event: TransferTerminalEvent) => void): () => void {
    return this.terminalEmitter.subscribe(cb);
  }

  onError(cb: (e: SessionError) => void): () => void {
    return this.errorEmitter.subscribe(cb);
  }

  private requestDownloadToInternal(
    fileId: string,
    sink: WritableStream<Uint8Array>,
    opts?: { onMeta?: (meta: FileDesc) => void },
  ): DownloadToSinkHandle {
    const transferId = createId();
    const peerFile = this.peerIndex.find((file) => file.id === fileId);
    const handle = this.incomingTransfers.createDownload(transferId, fileId, peerFile, sink, opts);

    return {
      transferId,
      done: handle.done,
      cancel: () => {
        this.cancelTransferInternal(transferId, {
          reason: 'USER_CANCELLED',
          message: 'cancelled by user',
          notifyPeer: true,
        });
      },
    };
  }

  private handleTransportError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const isTooLarge = message.includes('maxMessageBytes');

    this.emitSessionError(
      isTooLarge ? 'TRANSPORT_MESSAGE_TOO_LARGE' : 'TRANSPORT_PROTOCOL_VIOLATION',
      message,
      error,
    );

    if (this.cfg.closeOnProtocolViolation) {
      this.closeSession('transport protocol violation', true, 'SESSION_CLOSED');
    }
  }

  private handleInboundMessage = (wireBytes: Uint8Array): void => {
    const wire = this.decodeInboundWire(wireBytes);
    if (!wire) return;

    if (wire.k === 'control') {
      const control = this.decodeControl(wire.bytes);
      if (!control) return;
      this.handleControl(control);
      return;
    }

    this.handleDataFrame(wire.transferId16, wire.seq, wire.eof, wire.payload);
  };

  private decodeInboundWire(wireBytes: Uint8Array): ReturnType<typeof decodeWire> | null {
    try {
      return decodeWire(wireBytes);
    } catch (error) {
      this.emitSessionError('PROTOCOL_VIOLATION', 'Failed to decode inbound wire frame', error);
      if (this.cfg.closeOnProtocolViolation) {
        this.closeSession('protocol violation', true, 'SESSION_CLOSED');
      }
      return null;
    }
  }

  private decodeControl(bytes: Uint8Array): ControlMsg | null {
    try {
      return this.codec.decodeControl(bytes);
    } catch (error) {
      this.emitSessionError('CONTROL_DECODE_FAILED', 'Failed to decode control message', error);
      if (this.cfg.closeOnProtocolViolation) {
        this.closeSession('control decode failure', true, 'SESSION_CLOSED');
      }
      return null;
    }
  }

  private handleControl(msg: ControlMsg): void {
    if (msg.t === 'HELLO') {
      this.handleHello(msg);
      void this.inventorySync.sendCurrentInventorySnapshot().catch((error) => {
        this.emitSessionError('INVENTORY_SYNC_FAILED', 'Failed to send inventory snapshot', error);
      });
      return;
    }

    if (this.inventorySync.handleControlMessage(msg)) {
      return;
    }

    switch (msg.t) {
      case 'GET_FILE':
        this.outgoingTransfers.enqueueOutgoingSend(msg.transferId, msg.fileId);
        return;

      case 'FILE_META':
        this.handleIncomingMeta(msg.transferId, msg.file);
        return;

      case 'FILE_END':
        this.handleIncomingFileEnd(msg.transferId, msg.hash);
        return;

      case 'CANCEL':
        this.cancelTransferInternal(msg.transferId, {
          reason: 'PEER_CANCELLED',
          message: msg.reason ?? 'cancelled by peer',
          notifyPeer: false,
        });
        return;

      case 'ERROR':
        if (msg.scope === 'transfer' && msg.transferId) {
          this.failTransferById(
            msg.transferId,
            'PEER_ERROR',
            `${msg.code}: ${msg.message}`,
            undefined,
            false,
          );
          return;
        }

        this.emitSessionError('PROTOCOL_VIOLATION', `${msg.code}: ${msg.message}`);
        return;

      default:
        return;
    }
  }

  private handleHello(msg: HelloMsg): void {
    const negotiated = this.negotiateFromHello(msg);
    if (!negotiated.ok) {
      this.negotiation = {
        status: 'failed',
        settings: this.negotiation.settings,
        reason: negotiated.reason,
        code: negotiated.code,
      };
      this.emitSessionError(negotiated.code, negotiated.reason);
      this.closeSession(`negotiation failed: ${negotiated.reason}`, true, 'SESSION_CLOSED');
      return;
    }

    if (this.negotiation.status === 'established') {
      if (this.negotiation.peerSessionId !== msg.sessionId) {
        const reason = 'received HELLO from a different peer sessionId';
        this.negotiation = {
          status: 'failed',
          settings: this.negotiation.settings,
          reason,
          code: 'NEGOTIATION_FAILED',
        };
        this.emitSessionError('NEGOTIATION_FAILED', reason);
        this.closeSession(`negotiation failed: ${reason}`, true, 'SESSION_CLOSED');
        return;
      }

      if (this.negotiation.peerBuildId !== msg.appBuildId) {
        const reason = 'received HELLO from same sessionId with different build id';
        this.negotiation = {
          status: 'failed',
          settings: this.negotiation.settings,
          reason,
          code: 'BUILD_MISMATCH',
        };
        this.emitSessionError('BUILD_MISMATCH', reason);
        this.closeSession(`negotiation failed: ${reason}`, true, 'SESSION_CLOSED');
        return;
      }

      if (!isSameNegotiatedSessionSettings(this.negotiation.settings, negotiated.settings)) {
        const reason = 'received incompatible repeated HELLO negotiation parameters';
        this.negotiation = {
          status: 'failed',
          settings: this.negotiation.settings,
          reason,
          code: 'NEGOTIATION_FAILED',
        };
        this.emitSessionError('NEGOTIATION_FAILED', reason);
        this.closeSession(`negotiation failed: ${reason}`, true, 'SESSION_CLOSED');
      }
      return;
    }

    this.negotiation = {
      status: 'established',
      settings: negotiated.settings,
      peerSessionId: msg.sessionId,
      peerBuildId: msg.appBuildId,
    };
  }

  private negotiateFromHello(msg: HelloMsg) {
    return negotiateSessionFromHello(this.localHelloCapabilities, this.cfg.appBuildId, msg);
  }

  private canSendControlMessage(msg: ControlMsgWithoutProtocol): boolean {
    const protocol = this.resolveControlProtocol(msg);

    try {
      const encoded = this.codec.encodeControl({ ...msg, p: protocol } as ControlMsg);
      const wireLength = 1 + encoded.length;
      return wireLength <= this.currentNegotiatedSettings().maxMessageBytes;
    } catch {
      return false;
    }
  }

  private handleIncomingMeta(transferId: string, meta: FileMetaMsg['file']): void {
    this.incomingTransfers.handleIncomingMeta(transferId, meta);
  }

  private handleIncomingFileEnd(transferId: string, hash: FileHash | undefined): void {
    this.incomingTransfers.handleIncomingFileEnd(transferId, hash);
  }

  private handleDataFrame(
    transferId16: Uint8Array,
    seq: number,
    eof: boolean,
    payload: Uint8Array,
  ): void {
    let transferId: string;

    try {
      transferId = transferIdFrom16(transferId16);
    } catch (error) {
      this.emitSessionError('PROTOCOL_VIOLATION', 'Received malformed transfer id in DATA frame', error);
      return;
    }

    this.incomingTransfers.handleIncomingData(transferId, seq, eof, payload);
  }

  private failTransferById(
    transferId: string,
    code: TransferFailureCode,
    message: string,
    cause: unknown,
    notifyPeer: boolean,
  ): void {
    this.incomingTransfers.failTransferById(transferId, code, message, cause, notifyPeer);
    this.outgoingTransfers.failTransferById(transferId, code, message, cause, notifyPeer);
  }

  private cancelTransferInternal(
    transferId: string,
    opts: { reason: TransferCancelReason; message: string; notifyPeer: boolean },
  ): void {
    const incomingAffected = this.incomingTransfers.cancelTransferById(transferId, opts.reason, opts.message);
    const outgoingAffected = this.outgoingTransfers.cancelTransferById(transferId, opts.reason, opts.message);

    if ((incomingAffected || outgoingAffected) && opts.notifyPeer) {
      void this.sendControl({
        t: 'CANCEL',
        transferId,
        reason: opts.reason.toLowerCase(),
      }).catch(noop);
    }
  }

  private sendHelloAndSnapshot(): void {
    void this.sendControl(
      buildLocalHelloMessage(this.sessionId, this.cfg.appBuildId, this.localHelloCapabilities),
    ).catch(noop);
    void this.inventorySync.sendCurrentInventorySnapshot().catch(noop);
  }

  private currentNegotiatedSettings(): NegotiatedSessionSettings {
    return this.negotiation.settings;
  }

  private currentMaxFileBytes(): number {
    return Math.min(this.cfg.maxFileBytes, this.currentNegotiatedSettings().maxFileBytes);
  }

  private resolveControlProtocol(msg: ControlMsgWithoutProtocol): Protocol {
    void msg;
    return this.currentNegotiatedSettings().protocol;
  }

  private async sendControl(
    msg: ControlMsgWithoutProtocol,
    opts?: { protocol?: Protocol },
  ): Promise<void> {
    if (this.stateValue === 'closed') {
      throw new Error('session is closed');
    }

    const protocol = opts?.protocol ?? this.resolveControlProtocol(msg);
    const message: ControlMsg = { ...msg, p: protocol } as ControlMsg;

    let payload: Uint8Array;
    try {
      payload = this.codec.encodeControl(message);
    } catch (error) {
      this.emitSessionError('CONTROL_ENCODE_FAILED', 'Failed to encode control message', error);
      throw error;
    }

    const wire = encodeControlWire(payload);
    const negotiated = this.currentNegotiatedSettings();
    if (wire.length > negotiated.maxMessageBytes) {
      const error = new Error(
        `CONTROL message exceeds negotiated maxMessageBytes=${negotiated.maxMessageBytes} (got ${wire.length})`,
      );
      this.emitSessionError('CONTROL_SEND_FAILED', error.message, error);
      throw error;
    }

    try {
      await this.transport.sendMessage(wire, { priority: 'control' });
    } catch (error) {
      this.emitSessionError('CONTROL_SEND_FAILED', 'Failed to send control message', error);
      throw error;
    }
  }

  private emitTransferError(
    transferId: string,
    code: TransferFailureCode,
    message: string,
    cause?: unknown,
  ): void {
    this.errorEmitter.emit({
      scope: 'transfer',
      transferId,
      code,
      message,
      cause,
    });
  }

  private emitSessionError(code: SessionErrorCode, message: string, cause?: unknown): void {
    this.errorEmitter.emit({
      scope: 'session',
      code,
      message,
      cause,
    });
  }

  private closeSession(
    reason: string,
    closeChannel: boolean,
    transferCancelReason: TransferCancelReason,
  ): void {
    if (this.stateValue === 'closed') return;
    this.stateValue = 'closed';

    this.stopInventoryResend();

    safeCall(this.unsubTransportMessage);
    safeCall(this.unsubChannelClose);

    this.incomingTransfers.closeAll(reason, transferCancelReason);
    this.outgoingTransfers.closeAll(reason, transferCancelReason);

    this.localStore.clear();
    this.localIndex = [];
    this.peerIndex = [];
    this.inventorySync.dispose(createTransferException('RECV_FAILED', 'session is closed'));

    void this.transport.dispose();

    if (closeChannel) {
      safeCall(() => this.channel.close());
    }

    this.stateEmitter.emit('closed');

    this.stateEmitter.clear();
    this.localEmitter.clear();
    this.peerEmitter.clear();
    this.progressEmitter.clear();
    this.terminalEmitter.clear();
    this.errorEmitter.clear();
  }

  private stopInventoryResend(): void {
    if (this.inventoryResendTimer) {
      clearInterval(this.inventoryResendTimer);
      this.inventoryResendTimer = undefined;
    }
  }
}

function normalizeFiles(files: FileList | File[]): File[] {
  return Array.isArray(files) ? files.slice() : Array.from(files);
}

function fileToDesc(id: string, file: File): FileDesc {
  return {
    id,
    name: file.name,
    size: file.size,
    mime: file.type || 'application/octet-stream',
    mtime: Number.isFinite(file.lastModified) ? file.lastModified : undefined,
  };
}

function createId(): string {
  return bytes16ToB64u(newId16());
}

function safeCall(fn: (() => void) | undefined): void {
  if (!fn) return;
  try {
    fn();
  } catch {
    // ignore callback errors
  }
}

type Listener<T> = (value: T) => void;

function createEmitter<T>() {
  const listeners = new Set<Listener<T>>();

  return {
    emit(value: T): void {
      for (const listener of listeners) {
        safeCall(() => listener(value));
      }
    },

    subscribe(listener: Listener<T>): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    clear(): void {
      listeners.clear();
    },
  };
}

function noop(): void {}
