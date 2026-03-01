export type PakeRole = 'initiator' | 'responder';
export type PakeSessionId = string;

export interface PakePort {
  newSession(role: PakeRole, prs: Uint8Array): PakeSessionId;

  start(sessionId: PakeSessionId): Promise<Uint8Array>; // initiator -> msgA(payload)
  receive(sessionId: PakeSessionId, msg: Uint8Array): Promise<Uint8Array>; // responder -> msgB(payload), initiator -> empty Uint8Array

  exportISK(sessionId: PakeSessionId): Uint8Array;

  destroy(sessionId: PakeSessionId): void;
}
