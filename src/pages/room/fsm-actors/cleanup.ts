import type { Database } from 'firebase/database';
import { goOffline, ref, remove } from 'firebase/database';
import { getRoomFirebaseEnv, type RoomFirebaseEnvironment } from '../config/firebase';

export interface RoomCleanerDeps {
  database?: Database;
  removeFn?: typeof remove;
  goOfflineFn?: typeof goOffline;
  env?: RoomFirebaseEnvironment;
}

export class RoomCleaner {
  private readonly database?: Database;
  private readonly removeFn: typeof remove;
  private readonly goOfflineFn?: typeof goOffline;
  private readonly env: RoomFirebaseEnvironment;

  constructor(deps: RoomCleanerDeps = {}) {
    this.database = deps.database;
    this.removeFn = deps.removeFn ?? remove;
    this.goOfflineFn = deps.goOfflineFn ?? goOffline;
    this.env = deps.env ?? getRoomFirebaseEnv();
  }

  async cleanup(roomId: string, options?: { removeRoom?: boolean }): Promise<void> {
    const shouldRemove = options?.removeRoom ?? true;
    const database = this.database ?? this.env.db;
    try {
      if (shouldRemove && roomId) {
        await this.removeFn(ref(database, `rooms/${roomId}`));
      }
    } catch (error) {
      console.warn('Room cleanup error:', error);
    } finally {
      if (this.database) {
        this.goOfflineSafe(database);
      } else {
        this.env.cleanup();
      }
    }
  }

  private goOfflineSafe(database: Database): void {
    try {
      this.goOfflineFn?.(database);
    } catch (goOfflineError) {
      console.warn('Room goOffline error:', goOfflineError);
    }
  }
}
