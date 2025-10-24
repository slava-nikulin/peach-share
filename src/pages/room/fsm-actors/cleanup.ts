import type { Database } from 'firebase/database';
import { goOffline, ref, remove } from 'firebase/database';
import { db } from '../config/firebase';

export interface RoomCleanerDeps {
  database?: Database;
  removeFn?: typeof remove;
  goOfflineFn?: typeof goOffline;
}

export class RoomCleaner {
  private readonly database: Database;
  private readonly removeFn: typeof remove;
  private readonly goOfflineFn: typeof goOffline;

  constructor(deps: RoomCleanerDeps = {}) {
    this.database = deps.database ?? db;
    this.removeFn = deps.removeFn ?? remove;
    this.goOfflineFn = deps.goOfflineFn ?? goOffline;
  }

  async cleanup(roomId: string): Promise<void> {
    try {
      if (roomId) {
        await this.removeFn(ref(this.database, `rooms/${roomId}`));
      }
    } catch (error) {
      console.warn('Room cleanup error:', error);
    } finally {
      this.goOfflineSafe();
    }
  }

  private goOfflineSafe(): void {
    try {
      this.goOfflineFn(this.database);
    } catch (goOfflineError) {
      console.warn('Room goOffline error:', goOfflineError);
    }
  }
}
