import type { P2pChannel } from './p2p-channel';

export type WebRtcSessionId = string;
export type WebRtcRole = 'initiator' | 'responder';
export type WebRtcSignal = string; // opaque JSON (SignalData)

export interface WebRtcPort {
  newSession(role: WebRtcRole, rtcConfig?: RTCConfiguration): WebRtcSessionId;

  // initiator:
  generateOffer(sid: WebRtcSessionId): Promise<WebRtcSignal>;
  acceptAnswer(sid: WebRtcSessionId, answer: WebRtcSignal): void;

  // responder:
  generateAnswer(sid: WebRtcSessionId, offer: WebRtcSignal): Promise<WebRtcSignal>;

  // common:
  waitConnected(sid: WebRtcSessionId, timeoutMs: number): Promise<P2pChannel>;
  destroy(sid: WebRtcSessionId): void;
}
