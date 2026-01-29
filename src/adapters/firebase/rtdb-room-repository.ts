import type { Database } from 'firebase/database';
import { child, get, ref, remove, runTransaction, update } from 'firebase/database';
import type { RoomRepositoryPort } from '../../bll/ports/room-repository';
import { FirebaseCore } from './core';

type RepoOpts = {
  basePath?: string; // например "rooms"
  clock?: () => number;
};

export class RtdbRoomRepository implements RoomRepositoryPort {
  private readonly basePath: string;
  private readonly now: () => number;
  private readonly core: FirebaseCore;

  constructor(core: FirebaseCore, opts: RepoOpts = {}) {
    this.basePath = (opts.basePath ?? 'rooms').replace(/^\/+|\/+$/g, '');
    this.now = opts.clock ?? (() => Date.now());
    this.core = core;
  }

  async roomExists(roomId: string): Promise<boolean> {
    return this.core.withOnline(async (db) => {
      const snap = await get(this.roomRef(db, roomId));
      return snap.exists();
    });
  }

  // async getRoom(roomId: RoomId): Promise<RoomRecord | null> {
  //   return this.core.withOnline(async (db) => {
  //     const snap = await get(this.roomRef(db, roomId));
  //     return snap.exists() ? (snap.val() as RoomRecord) : null;
  //   });
  // }

  // /**
  //  * Атомарно создаёт комнату, если её нет.
  //  * Возвращает true, если создал, false если уже существовала.
  //  */
  // async createRoomIfAbsent(roomId: RoomId, payload: RoomRecord): Promise<boolean> {
  //   return this.core.withOnline(async (db) => {
  //     const r = this.roomRef(db, roomId);
  //     const now = this.now();

  //     const tx = await runTransaction(
  //       r,
  //       (current) => {
  //         if (current !== null && current !== undefined) return; // abort => уже есть
  //         return {
  //           ...payload,
  //           createdAt: payload.createdAt ?? now,
  //           updatedAt: payload.updatedAt ?? now,
  //         } satisfies RoomRecord;
  //       },
  //       {
  //         applyLocally: false,
  //       },
  //     );

  //     // committed=false означает, что транзакция не применилась (т.к. abort)
  //     return tx.committed === true;
  //   });
  // }

  // async updateRoom(roomId: RoomId, patch: Partial<RoomRecord>): Promise<void> {
  //   return this.core.withOnline(async (db) => {
  //     const now = this.now();
  //     await update(this.roomRef(db, roomId), {
  //       ...patch,
  //       updatedAt: now,
  //     });
  //   });
  // }

  async deleteRoom(roomId: string): Promise<void> {
    return this.core.withOnline(async (db) => {
      await remove(this.roomRef(db, roomId));
    });
  }

  private roomRef(db: Database, roomId: string) {
    const root = ref(db);
    return child(root, `${this.basePath}/${encodeURIComponent(roomId)}`);
  }
}
