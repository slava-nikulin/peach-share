import { Mutex } from 'async-mutex';
import type { Database } from 'firebase/database';
import { goOffline, goOnline } from 'firebase/database';

export class RtdbConnectionScope {
  private readonly mutex = new Mutex();

  constructor(private readonly db: Database) {}

  run<T>(fn: (db: Database) => Promise<T>): Promise<T> {
    return this.mutex.runExclusive(async () => {
      goOnline(this.db);
      try {
        return await fn(this.db);
      } finally {
        goOffline(this.db);
      }
    });
  }
}
