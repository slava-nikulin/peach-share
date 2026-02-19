export interface RoomRepositoryPort {
  roomCreate(uid: string, roomId: string, timeoutMs: number): Promise<void>;
  roomJoin(uid: string, roomId: string, timeoutMs: number): Promise<void>;
  finalize(roomId: string): Promise<void>;

  waitA(roomId: string, timeoutMs: number): Promise<string>;
  writeA(roomId: string, payloadB64u: string): Promise<void>;
  waitB(roomId: string, timeoutMs: number): Promise<string>;
  writeB(roomId: string, payloadB64u: string): Promise<void>;

  waitKcA(roomId: string, timeoutMs: number): Promise<string>;
  writeKcA(roomId: string, tagB64u: string): Promise<void>;
  waitKcB(roomId: string, timeoutMs: number): Promise<string>;
  writeKcB(roomId: string, tagB64u: string): Promise<void>;

  waitOffer(roomId: string, timeoutMs: number): Promise<string>;
  writeOffer(roomId: string, boxedOffer: string): Promise<void>;
  waitAnswer(roomId: string, timeoutMs: number): Promise<string>;
  writeAnswer(roomId: string, boxedAnswer: string): Promise<void>;
}
