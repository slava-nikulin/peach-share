// tests/setup/node-webrtc.ts
import { webcrypto } from 'node:crypto';

type WrtcModule = typeof import('@avahq/wrtc');
type GlobalWebRTCContext = typeof globalThis & {
  crypto?: Crypto;
  RTCPeerConnection?: typeof RTCPeerConnection;
  RTCSessionDescription?: typeof RTCSessionDescription;
  RTCIceCandidate?: typeof RTCIceCandidate;
  navigator?: { userAgent: string };
};

const wrtc: WrtcModule = await import('@avahq/wrtc');
const globalContext = globalThis as GlobalWebRTCContext;

globalContext.crypto ??= webcrypto as unknown as Crypto;
globalContext.RTCPeerConnection ??= wrtc.RTCPeerConnection as unknown as typeof RTCPeerConnection;
globalContext.RTCSessionDescription ??=
  wrtc.RTCSessionDescription as unknown as typeof RTCSessionDescription;
globalContext.RTCIceCandidate ??= wrtc.RTCIceCandidate as unknown as typeof RTCIceCandidate;

if (!('window' in globalContext)) {
  Reflect.set(globalContext, 'window', globalContext);
} else if (!globalContext.window) {
  Reflect.set(globalContext, 'window', globalContext);
}

if (!('self' in globalContext)) {
  Reflect.set(globalContext, 'self', globalContext);
} else if (!globalContext.self) {
  Reflect.set(globalContext, 'self', globalContext);
}

if (!globalContext.navigator) {
  Reflect.set(globalContext, 'navigator', { userAgent: 'vitest-node' });
}
