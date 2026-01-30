import type { Database } from 'firebase/database';
import { child, get, ref, remove } from 'firebase/database';
import type { RoomRepositoryPort } from '../../bll/ports/room-repository';
import type { FirebaseCore } from './core';

export class RtdbRoomRepository implements RoomRepositoryPort {
  private readonly basePath: string;
  private readonly core: FirebaseCore;

  constructor(core: FirebaseCore) {
    this.basePath = 'rooms';
    this.core = core;
  }

  async roomExists(roomId: string): Promise<boolean> {
    return this.core.withOnline(async (db) => {
      const snap = await get(this.roomRef(db, roomId));
      return snap.exists();
    });
  }

  async deleteRoom(roomId: string): Promise<void> {
    return this.core.withOnline(async (db) => {
      await remove(this.roomRef(db, roomId));
    });
  }

  private roomRef(db: Database, roomId: string) {
    const root = ref(db);
    return child(root, `${this.basePath}/${roomId}`);
  }
}
