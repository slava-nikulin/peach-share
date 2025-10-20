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
}

type SignalingPaths = ReturnType<typeof sigPaths>;

const DEFAULT_CHANNEL_LABEL = 'meta';

export class WebRTCConnection implements RtcEndpoint {
  private readonly dbRoomRef: DatabaseReference;
  private readonly role: Role;
  private readonly encKey: Uint8Array;
  private readonly timeoutMs: number;
  private readonly stun?: RTCIceServer[];
  private _channelLabel: string;

  private _pc!: RTCPeerConnection;
  private _channel!: RTCDataChannel;
  private stopLocal?: () => void;
  private stopRemote?: () => void;
  private aesKey?: CryptoKey;
  private paths?: SignalingPaths;
  private initialized = false;
  private isClosed = false;

  public ready!: Promise<void>;

  private constructor(options: WebRTCConnectionOptions) {
    this.dbRoomRef = options.dbRoomRef;
    this.role = options.role;
    this.encKey = options.encKey;
    this.timeoutMs = options.timeoutMs;
    this.stun = options.stun;
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
    const channel = this.ensureChannel();
    channel.send(JSON.stringify(payload));
  };

  public readonly sendBinary = (buf: ArrayBuffer | ArrayBufferView): void => {
    const channel = this.ensureChannel();
    const payload = normalizeBinaryData(buf);
    if (payload) {
      channel.send(payload);
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
      const payload = normalizeBinaryData(event.data);
      if (payload) fn(payload);
    };

    channel.addEventListener('message', handler);
    return () => channel.removeEventListener('message', handler);
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
      this._channel?.close();
    } catch {}
    try {
      this._pc?.close();
    } catch {}
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
      this.ready = WebRTCConnection.createReadyPromise(this._pc, this._channel);
      this.initialized = true;
    } catch (error) {
      this.cleanupOnFailure();
      throw error;
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
      return Promise.resolve(pc.createDataChannel(channelLabel, { ordered: true }));
    }

    return new Promise((resolve) => {
      const handleDataChannel = (event: RTCDataChannelEvent): void => {
        if (event.channel.label === channelLabel) {
          pc.removeEventListener('datachannel', handleDataChannel);
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
        void pushEncrypted(targetRef, aesKey, event.candidate.toJSON());
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
    const q: RTCIceCandidateInit[] = [];
    let rdSet = false;

    pc.addEventListener('signalingstatechange', () => {
      if (pc.signalingState === 'stable' || pc.remoteDescription) {
        rdSet = true;
        while (q.length) {
          const cand = q.shift();
          if (!cand) continue;
          pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
        }
      }
    });

    return onEachEncrypted<RTCIceCandidateInit>(src, key, (cand) => {
      if (!rdSet) {
        q.push(cand);
        return;
      }
      pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
    });
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

  private static createReadyPromise(pc: RTCPeerConnection, channel: RTCDataChannel): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = (): void => {
        pc.removeEventListener('iceconnectionstatechange', handleIceStateChange);
        channel.removeEventListener('open', handleChannelOpen);
      };

      const resolveOnce = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const rejectOnce = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('ice_failed'));
      };

      const handleIceStateChange = (): void => {
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          resolveOnce();
        } else if (pc.iceConnectionState === 'failed' || pc.connectionState === 'failed') {
          rejectOnce();
        }
      };

      const handleChannelOpen = (): void => {
        if (channel.readyState === 'open') {
          resolveOnce();
        }
      };

      pc.addEventListener('iceconnectionstatechange', handleIceStateChange);
      channel.addEventListener('open', handleChannelOpen);

      handleIceStateChange();
      handleChannelOpen();
    });
  }
}

export async function setupWebRTC(options: WebRTCConnectionOptions): Promise<RtcEndpoint> {
  return WebRTCConnection.create(options);
}

function normalizeBinaryData(data: unknown): ArrayBuffer | undefined {
  if (data instanceof ArrayBuffer) {
    return data;
  }
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    const source = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    return new Uint8Array(source).buffer;
  }
  return undefined;
}
