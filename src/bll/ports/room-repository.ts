export interface RoomRepositoryPort {
  roomExists(roomId: string): Promise<boolean>;
}
// опционально, но обычно нужно
// createRoomIfAbsent(roomId: RoomId, payload: RoomRecord): Promise<boolean>; // true если создали
// getRoom(roomId: RoomId): Promise<RoomRecord | null>;
// updateRoom(roomId: RoomId, patch: Partial<RoomRecord>): Promise<void>;
// deleteRoom(roomId: RoomId): Promise<void>;

// export type RoomRecord = {
//   createdAt?: number; // epoch ms
//   updatedAt?: number; // epoch ms
//   // дальше любые поля комнаты
//   name?: string;
//   ownerId?: string;
// };
