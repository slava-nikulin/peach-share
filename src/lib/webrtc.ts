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

interface SetupArgs {
  dbRoomRef: DatabaseReference; // ref(db, `rooms/${roomId}`)
  role: Role; // 'owner' | 'guest'
  encKey: Uint8Array; // из DH
  timeoutMs: number; // напр. 120_000
  stun?: RTCIceServer[]; // опционально
}

type SignalingPaths = ReturnType<typeof sigPaths>;

const CHANNEL_LABEL = 'meta';

export async function setupWebRTC(args: SetupArgs): Promise<RtcEndpoint> {
  const { dbRoomRef, role, encKey, timeoutMs, stun } = args;
  const aesKey = await importAesGcmKey(encKey);
  const paths = sigPaths({ roomRef: dbRoomRef, role });
  const pc = createPeerConnection(stun);
  const channelPromise = createChannelPromise(pc, role);
  const stopLocal = forwardLocalCandidates(pc, aesKey, paths.myCandidatesRef);
  const stopRemote = subscribeRemoteCandidates(pc, aesKey, paths.theirCandidatesRef);

  try {
    await exchangeDescriptions({ pc, role, aesKey, timeoutMs, paths });
    const channel = await channelPromise;
    const ready = createReadyPromise(pc, channel);
    const api = createChannelApi(channel);
    const close = (): void => {
      stopLocal();
      stopRemote();
      channel.close();
      pc.close();
    };
    return { pc, channel, ready, close, ...api };
  } catch (e) {
    // убираем подписки, чтобы не стреляли асинхронно после реджекта
    try {
      stopLocal();
    } catch {}
    try {
      stopRemote();
    } catch {}
    try {
      pc.close();
    } catch {}
    throw e;
  }
}

function createChannelPromise(pc: RTCPeerConnection, role: Role): Promise<RTCDataChannel> {
  if (role === 'owner') {
    return Promise.resolve(pc.createDataChannel(CHANNEL_LABEL, { ordered: true }));
  }

  return new Promise((resolve) => {
    const handleDataChannel = (event: RTCDataChannelEvent): void => {
      if (event.channel.label === CHANNEL_LABEL) {
        pc.removeEventListener('datachannel', handleDataChannel);
        resolve(event.channel);
      }
    };

    pc.addEventListener('datachannel', handleDataChannel);
  });
}

function createPeerConnection(stun?: RTCIceServer[]): RTCPeerConnection {
  const PeerCtor = globalThis.RTCPeerConnection;
  if (!PeerCtor) throw new ReferenceError('RTCPeerConnection is not available (polyfill missing)');
  return new PeerCtor({ iceServers: stun ?? [] });
}

function forwardLocalCandidates(
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

  return () => {
    pc.removeEventListener('icecandidate', handleIceCandidate);
  };
}

function subscribeRemoteCandidates(
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
interface ExchangeArgs {
  pc: RTCPeerConnection;
  role: Role;
  aesKey: CryptoKey;
  timeoutMs: number;
  paths: SignalingPaths;
}

async function exchangeDescriptions({
  pc,
  role,
  aesKey,
  timeoutMs,
  paths,
}: ExchangeArgs): Promise<void> {
  if (role === 'owner') {
    const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
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

function createReadyPromise(pc: RTCPeerConnection, channel: RTCDataChannel): Promise<void> {
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

type ChannelApi = Pick<RtcEndpoint, 'sendBinary' | 'sendJSON' | 'onBinary' | 'onJSON'>;

function createChannelApi(channel: RTCDataChannel): ChannelApi {
  const sendJSON = (payload: unknown): void => {
    channel.send(JSON.stringify(payload));
  };

  const sendBinary = (buf: ArrayBuffer | ArrayBufferView): void => {
    const payload = normalizeBinaryData(buf);
    if (payload) {
      channel.send(payload);
    }
  };

  const onJSON = (fn: (payload: unknown) => void): (() => void) => {
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

  const onBinary = (fn: (buf: ArrayBuffer) => void): (() => void) => {
    const handler = (event: MessageEvent<unknown>): void => {
      const { data } = event;
      const payload = normalizeBinaryData(data);
      if (payload) fn(payload);
    };

    channel.addEventListener('message', handler);
    return () => channel.removeEventListener('message', handler);
  };

  return { sendJSON, sendBinary, onJSON, onBinary };
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
