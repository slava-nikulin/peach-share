import type { DatabaseReference } from 'firebase/database';
import type { Role } from '../pages/room/types';
import {
  importAesGcmKey,
  onEachEncrypted,
  pushEncrypted,
  sigPaths,
  waitEncrypted,
  writeEncrypted,
} from './crypto-webrtc';

export interface RtcEndpoint {
  pc: RTCPeerConnection;
  channel: RTCDataChannel;
  sendJSON: (payload: unknown) => void;
  sendBinary: (buf: ArrayBuffer | ArrayBufferView) => void;
  onJSON: (fn: (payload: unknown) => void) => () => void;
  onBinary: (fn: (buf: ArrayBuffer) => void) => () => void;
  close: () => void;
  ready: Promise<void>;
}

interface WebRTCConnectionOptions {
  dbRoomRef: DatabaseReference;
  role: Role;
  encKey: Uint8Array;
  timeoutMs: number;
  stun?: RTCIceServer[];
  channelLabel?: string;
  abortSignal?: AbortSignal;
}

type SignalingPaths = ReturnType<typeof sigPaths>;

const DEFAULT_CHANNEL_LABEL = 'meta';
const MAX_PENDING_MESSAGES = 128;

type PendingMessage = { kind: 'json'; data: string } | { kind: 'binary'; data: ArrayBuffer };

export class WebRTCConnection implements RtcEndpoint {
  private readonly dbRoomRef: DatabaseReference;
  private readonly role: Role;
  private readonly encKey: Uint8Array;
  private readonly timeoutMs: number;
  private readonly stun?: RTCIceServer[];
  private readonly abortSignal?: AbortSignal;
  private _channelLabel: string;

  private _pc!: RTCPeerConnection;
  private _channel!: RTCDataChannel;
  private stopLocal?: () => void;
  private stopRemote?: () => void;
  private aesKey?: CryptoKey;
  private paths?: SignalingPaths;
  private initialized = false;
  private isClosed = false;
  private pendingMessages: PendingMessage[] = [];
  private channelOpenHandler?: () => void;
  private channelCloseHandler?: () => void;

  public ready!: Promise<void>;

  private constructor(options: WebRTCConnectionOptions) {
    this.dbRoomRef = options.dbRoomRef;
    this.role = options.role;
    this.encKey = options.encKey;
    this.timeoutMs = options.timeoutMs;
    this.stun = options.stun;
    this.abortSignal = options.abortSignal;
    this._channelLabel = options.channelLabel ?? DEFAULT_CHANNEL_LABEL;
  }

  static async create(options: WebRTCConnectionOptions): Promise<WebRTCConnection> {
    const connection = new WebRTCConnection(options);
    await connection.initialize();
    return connection;
  }

  get pc(): RTCPeerConnection {
    return this.ensurePeerConnection();
  }

  get channel(): RTCDataChannel {
    return this.ensureChannel();
  }

  get channelLabel(): string {
    return this._channelLabel;
  }

  set channelLabel(value: string) {
    if (this.initialized) throw new Error('Cannot change channel label after initialization');
    const trimmed = value?.trim();
    this._channelLabel = trimmed || DEFAULT_CHANNEL_LABEL;
  }

  public readonly sendJSON = (payload: unknown): void => {
    const data = JSON.stringify(payload);
    this.sendOrQueue({ kind: 'json', data });
  };

  public readonly sendBinary = (buf: ArrayBuffer | ArrayBufferView): void => {
    // ensure channel initialized even if we end up queuing
    this.ensureChannel();
    const payload = normalizeBinaryData(buf);
    if (payload instanceof Promise) {
      payload
        .then((resolved) => {
          if (resolved) this.sendOrQueue({ kind: 'binary', data: resolved });
        })
        .catch(() => {});
      return;
    }
    if (payload) {
      this.sendOrQueue({ kind: 'binary', data: payload });
    }
  };

  public readonly onJSON = (fn: (payload: unknown) => void): (() => void) => {
    const channel = this.ensureChannel();
    const handler = (event: MessageEvent<unknown>): void => {
      if (typeof event.data === 'string') {
        try {
          fn(JSON.parse(event.data) as unknown);
        } catch {
          /* ignore invalid JSON */
        }
      }
    };

    channel.addEventListener('message', handler);
    return () => channel.removeEventListener('message', handler);
  };

  public readonly onBinary = (fn: (buf: ArrayBuffer) => void): (() => void) => {
    const channel = this.ensureChannel();
    const handler = (event: MessageEvent<unknown>): void => {
      const maybe = normalizeBinaryData(event.data);
      if (maybe instanceof Promise) {
        maybe.then((b) => b && fn(b)).catch(() => {});
      } else if (maybe) fn(maybe);
    };
    channel.addEventListener('message', handler);
    const dispose = (): void => channel.removeEventListener('message', handler);
    return dispose;
  };

  public readonly close = (): void => {
    if (this.isClosed) return;
    this.isClosed = true;
    try {
      this.stopLocal?.();
    } catch {}
    try {
      this.stopRemote?.();
    } catch {}
    try {
      this.teardownChannelHandlers();
      this._channel?.close();
    } catch {}
    try {
      this._pc?.close();
    } catch {}
    this.pendingMessages = [];
  };

  private async initialize(): Promise<void> {
    this.aesKey = await importAesGcmKey(this.encKey);
    this.paths = sigPaths({ roomRef: this.dbRoomRef, role: this.role });
    this._pc = WebRTCConnection.createPeerConnection(this.stun);
    const channelPromise = WebRTCConnection.createChannelPromise(
      this._pc,
      this.role,
      this.channelLabel,
    );
    this.stopLocal = WebRTCConnection.forwardLocalCandidates(
      this._pc,
      this.aesKey,
      this.paths.myCandidatesRef,
    );
    this.stopRemote = WebRTCConnection.subscribeRemoteCandidates(
      this._pc,
      this.aesKey,
      this.paths.theirCandidatesRef,
    );

    try {
      await WebRTCConnection.exchangeDescriptions({
        pc: this._pc,
        role: this.role,
        aesKey: this.aesKey,
        timeoutMs: this.timeoutMs,
        paths: this.paths,
      });
      this._channel = await channelPromise;
      this.attachChannel(this._channel);
      this.ready = WebRTCConnection.createReadyPromise({
        pc: this._pc,
        channel: this._channel,
        timeoutMs: this.timeoutMs, // используем тот же бюджет
        onFail: () => this.close(), // общий teardown
        signal: this.abortSignal, // опционально
      });
      this.initialized = true;
    } catch (error) {
      this.cleanupOnFailure();
      throw error;
    }
  }

  private attachChannel(channel: RTCDataChannel): void {
    channel.binaryType = 'arraybuffer';

    this.channelOpenHandler = (): void => this.flushPendingMessages();
    this.channelCloseHandler = (): void => {
      this.pendingMessages = [];
      if (this.channelOpenHandler) channel.removeEventListener('open', this.channelOpenHandler);
      if (this.channelCloseHandler) channel.removeEventListener('close', this.channelCloseHandler);
    };

    if (this.channelOpenHandler) channel.addEventListener('open', this.channelOpenHandler);
    if (this.channelCloseHandler) channel.addEventListener('close', this.channelCloseHandler);
    this.flushPendingMessages();
  }

  private teardownChannelHandlers(): void {
    if (!this._channel) return;
    if (this.channelOpenHandler) {
      try {
        this._channel.removeEventListener('open', this.channelOpenHandler);
      } catch {}
    }
    if (this.channelCloseHandler) {
      try {
        this._channel.removeEventListener('close', this.channelCloseHandler);
      } catch {}
    }
    this.channelOpenHandler = undefined;
    this.channelCloseHandler = undefined;
  }

  private sendOrQueue(message: PendingMessage): void {
    const channel = this.ensureChannel();

    if (channel.readyState === 'open') {
      this.dispatchMessage(channel, message);
      return;
    }

    if (channel.readyState === 'closing' || channel.readyState === 'closed') {
      throw new Error('data_channel_unavailable');
    }

    if (this.pendingMessages.length >= MAX_PENDING_MESSAGES) {
      console.warn('rtc: dropping message, data channel not open yet');
      return;
    }
    this.pendingMessages.push(message);
  }

  private dispatchMessage(channel: RTCDataChannel, message: PendingMessage): void {
    if (message.kind === 'json') {
      channel.send(message.data);
      return;
    }
    channel.send(message.data);
  }

  private flushPendingMessages(): void {
    if (this.pendingMessages.length === 0) return;
    const channel = this._channel;
    if (!channel || channel.readyState !== 'open') return;
    while (this.pendingMessages.length) {
      const next = this.pendingMessages.shift();
      if (!next) break;
      this.dispatchMessage(channel, next);
    }
  }

  private ensurePeerConnection(): RTCPeerConnection {
    if (!this.initialized) {
      throw new Error('RTCPeerConnection is not initialized yet');
    }
    return this._pc;
  }

  private ensureChannel(): RTCDataChannel {
    if (!this.initialized) {
      throw new Error('WebRTC connection is not ready yet');
    }
    return this._channel;
  }

  private cleanupOnFailure(): void {
    try {
      this.stopLocal?.();
    } catch {}
    try {
      this.stopRemote?.();
    } catch {}
    try {
      this._pc?.close();
    } catch {}
  }

  private static createPeerConnection(stun?: RTCIceServer[]): RTCPeerConnection {
    const PeerCtor = globalThis.RTCPeerConnection;
    if (!PeerCtor)
      throw new ReferenceError('RTCPeerConnection is not available (polyfill missing)');
    return new PeerCtor({ iceServers: stun ?? [] });
  }

  private static createChannelPromise(
    pc: RTCPeerConnection,
    role: Role,
    channelLabel: string,
  ): Promise<RTCDataChannel> {
    if (role === 'owner') {
      const channel = pc.createDataChannel(channelLabel, { ordered: true });
      channel.binaryType = 'arraybuffer';
      return Promise.resolve(channel);
    }

    return new Promise((resolve) => {
      const handleDataChannel = (event: RTCDataChannelEvent): void => {
        if (event.channel.label === channelLabel) {
          pc.removeEventListener('datachannel', handleDataChannel);
          event.channel.binaryType = 'arraybuffer';
          resolve(event.channel);
        }
      };

      pc.addEventListener('datachannel', handleDataChannel);
    });
  }

  private static forwardLocalCandidates(
    pc: RTCPeerConnection,
    aesKey: CryptoKey,
    targetRef: DatabaseReference,
  ): () => void {
    const handleIceCandidate = (event: RTCPeerConnectionIceEvent): void => {
      if (event.candidate) {
        void pushEncrypted(targetRef, aesKey, event.candidate.toJSON()).catch((error) => {
          const code =
            (error as { code?: string })?.code ?? (error as { message?: string })?.message;
          if (typeof code === 'string' && code.includes('PERMISSION_DENIED')) {
            console.debug('Skipping ICE candidate push due to permissions', error);
          } else {
            console.warn('Failed to push ICE candidate', error);
          }
        });
      }
    };

    pc.addEventListener('icecandidate', handleIceCandidate);

    return (): void => {
      pc.removeEventListener('icecandidate', handleIceCandidate);
    };
  }

  private static subscribeRemoteCandidates(
    pc: RTCPeerConnection,
    key: CryptoKey,
    src: DatabaseReference,
  ): () => void {
    const MAX_Q = 500;
    const q: RTCIceCandidateInit[] = [];
    const hasRemoteDescription = (): boolean => !!pc.remoteDescription;

    const safeAdd = (cand: RTCIceCandidateInit): void => {
      pc.addIceCandidate(new RTCIceCandidate(cand)).catch((err) =>
        console.warn('addIceCandidate failed', err),
      );
    };

    const flushQueue = (): void => {
      if (!hasRemoteDescription()) return;
      while (q.length) {
        const cand = q.shift();
        if (!cand) continue;
        safeAdd(cand);
      }
    };

    const handleSignalingStateChange = (): void => {
      flushQueue();
    };

    const nativeSetRemoteDescription =
      typeof pc.setRemoteDescription === 'function' ? pc.setRemoteDescription : undefined;

    if (nativeSetRemoteDescription) {
      pc.setRemoteDescription = (async (
        ...args: Parameters<RTCPeerConnection['setRemoteDescription']>
      ) => {
        const result = await nativeSetRemoteDescription.apply(pc, args);
        flushQueue();
        return result;
      }) as RTCPeerConnection['setRemoteDescription'];
    }

    pc.addEventListener('signalingstatechange', handleSignalingStateChange);
    flushQueue();

    const stopOnEachEncrypted = onEachEncrypted<RTCIceCandidateInit>(src, key, (cand) => {
      if (!hasRemoteDescription()) {
        if (q.length < MAX_Q) {
          q.push(cand);
        }
        return;
      }
      safeAdd(cand);
    });

    return (): void => {
      pc.removeEventListener('signalingstatechange', handleSignalingStateChange);
      if (nativeSetRemoteDescription) {
        pc.setRemoteDescription = nativeSetRemoteDescription;
      }
      stopOnEachEncrypted();
    };
  }

  private static async exchangeDescriptions({
    pc,
    role,
    aesKey,
    timeoutMs,
    paths,
  }: {
    pc: RTCPeerConnection;
    role: Role;
    aesKey: CryptoKey;
    timeoutMs: number;
    paths: SignalingPaths;
  }): Promise<void> {
    if (role === 'owner') {
      const offer = await pc.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
      });
      await pc.setLocalDescription(offer);

      await writeEncrypted(paths.offerRef, aesKey, offer);
      const answer = await waitEncrypted<RTCSessionDescriptionInit>(
        paths.theirAnswerRef,
        aesKey,
        timeoutMs,
      );

      await pc.setRemoteDescription(new RTCSessionDescription(answer));

      return;
    }

    const offer = await waitEncrypted<RTCSessionDescriptionInit>(
      paths.theirOfferRef,
      aesKey,
      timeoutMs,
    );

    await pc.setRemoteDescription(new RTCSessionDescription(offer));

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await writeEncrypted(paths.answerRef, aesKey, answer);
  }

  private static makeAbortError(): Error {
    return typeof DOMException !== 'undefined'
      ? new DOMException('Aborted', 'AbortError')
      : new Error('AbortError');
  }

  private static createReadyPromise(opts: {
    pc: RTCPeerConnection;
    channel: RTCDataChannel;
    timeoutMs?: number;
    signal?: AbortSignal;
    onFail?: () => void;
  }): Promise<void> {
    const { pc, channel, timeoutMs, signal, onFail } = opts;
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const abortError = WebRTCConnection.makeAbortError();

      const cleanup = (): void => {
        pc.removeEventListener('iceconnectionstatechange', onIce);
        pc.removeEventListener('connectionstatechange', onConn);
        channel.removeEventListener('open', onOpen);
        signal?.removeEventListener('abort', onAbort);
        if (typeof timer !== 'undefined') clearTimeout(timer);
      };

      const settle = (ok: boolean, reason?: unknown): void => {
        if (settled) return;
        settled = true;
        cleanup();
        if (ok) {
          resolve();
        } else {
          onFail?.();
          reject(reason);
        }
      };

      const onOpen = (): void => {
        if (channel.readyState === 'open') settle(true);
      };
      const onIce = (): void => {
        const s = pc.iceConnectionState;
        if (s === 'connected' || s === 'completed') settle(true);
        else if (s === 'failed') settle(false, new Error('ice_failed'));
      };
      const onConn = (): void => {
        const s = pc.connectionState;
        if (s === 'connected') settle(true);
        else if (s === 'failed' || s === 'disconnected' || s === 'closed')
          settle(false, new Error(`conn_${s}`));
      };
      const onAbort = (): void => settle(false, abortError);

      if (signal?.aborted) {
        onAbort();
        return;
      }

      pc.addEventListener('iceconnectionstatechange', onIce);
      pc.addEventListener('connectionstatechange', onConn);
      channel.addEventListener('open', onOpen);
      signal?.addEventListener('abort', onAbort);
      if (timeoutMs && timeoutMs > 0)
        timer = setTimeout(() => settle(false, new Error('ready_timeout')), timeoutMs);

      onIce();
      onConn();
      onOpen();
    });
  }
}

export async function setupWebRTC(options: WebRTCConnectionOptions): Promise<RtcEndpoint> {
  return WebRTCConnection.create(options);
}

function cloneBuffer(
  source: ArrayBufferLike,
  byteOffset: number = 0,
  byteLength?: number,
): ArrayBuffer {
  const view = new Uint8Array(source, byteOffset, byteLength ?? source.byteLength - byteOffset);
  const copy = new Uint8Array(view.length);
  copy.set(view);
  return copy.buffer;
}

function normalizeBinaryData(data: ArrayBuffer | ArrayBufferView): ArrayBuffer;
function normalizeBinaryData(data: Blob): Promise<ArrayBuffer>;
function normalizeBinaryData(
  data: unknown,
): Promise<ArrayBuffer | undefined> | ArrayBuffer | undefined;
function normalizeBinaryData(
  data: unknown,
): Promise<ArrayBuffer | undefined> | ArrayBuffer | undefined {
  if (data instanceof ArrayBuffer) return data;
  if (typeof SharedArrayBuffer !== 'undefined' && data instanceof SharedArrayBuffer) {
    return cloneBuffer(data);
  }
  if (ArrayBuffer.isView(data)) {
    const v = data as ArrayBufferView;
    return cloneBuffer(v.buffer, v.byteOffset, v.byteLength);
  }
  if (data instanceof Blob) {
    // fallback на случай, если binaryType не успели зафиксировать
    return data.arrayBuffer();
  }
  return undefined;
}
