export interface RoomIdKdfPort {
  deriveRoomId(prs: string, salt: Uint8Array): Promise<Uint8Array>;
}
