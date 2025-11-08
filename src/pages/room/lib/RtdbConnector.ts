import type { FirebaseApp } from 'firebase/app';
import {
  connectDatabaseEmulator,
  type Database,
  getDatabase,
  goOffline,
  goOnline,
  onValue,
  ref,
} from 'firebase/database';

export interface RtdbConnectorOptions {
  app: FirebaseApp;
}

type Unsub = () => void;

export class RtdbConnector {
  private db?: Database;
  private online = false;
  private subs: Unsub[] = [];
  private readonly opts: RtdbConnectorOptions;

  constructor(opts: RtdbConnectorOptions) {
    this.opts = opts;
  }

  public connect(): Database {
    if (this.db) return this.db;

    const env = import.meta.env;

    if (env.VITE_USE_EMULATORS === 'true') {
      this.pruneFirebaseLocalStorage();
      const protocol = window.location.protocol;
      const hostname = window.location.hostname;
      const port = protocol === 'https:' ? Number(env.VITE_EMULATOR_RTDB_PORT || 9443) : 9000;
      const ns = env.VITE_EMULATOR_RTD_NS;

      // enableLogging(true);
      const db = getDatabase(this.opts.app, `${protocol}//${hostname}:${port}?ns=${ns}`);

      try {
        connectDatabaseEmulator(db, hostname, port);
      } catch (e) {
        console.error('[RtdbConnector] Error connecting to emulator:', e);
      }

      // Принудительное включение secure режима
      if (env.VITE_USE_LOCAL_SECURED_CONTEXT === 'true' && protocol === 'https:') {
        try {
          const dbAny = db as any;
          if (dbAny._repo?.repoInfo_) {
            dbAny._repo.repoInfo_.secure = true;
          }
        } catch (e) {
          console.warn('[RtdbConnector] Warning: Could not force secure connection:', e);
        }
      }

      this.db = db;
    } else {
      this.db = getDatabase(this.opts.app);
    }

    this.ensureOnline();

    return this.db!;
  }

  public ensureOnline(): void {
    if (!this.db || this.online) return;
    goOnline(this.db);
    this.online = true;
  }

  public subscribeConnected(cb: (connected: boolean) => void): Unsub {
    const db = this.connect();
    const infoRef = ref(db, '/.info/connected');
    const unsub = onValue(infoRef, (snap) => cb(Boolean(snap.val())));
    this.subs.push(unsub);
    return () => {
      unsub();
      this.subs = this.subs.filter((u) => u !== unsub);
    };
  }

  public cleanup(): void {
    for (const unsub of this.subs) {
      try {
        unsub();
      } catch {}
    }
    this.subs = [];

    if (this.db && this.online) {
      try {
        goOffline(this.db);
      } catch {}
      this.online = false;
    }
  }

  private pruneFirebaseLocalStorage(): void {
    if (typeof window === 'undefined') return;
    try {
      const ls = window.localStorage;
      const keys: string[] = [];
      for (let i = 0; i < ls.length; i += 1) {
        const k = ls.key(i);
        if (k?.startsWith('firebase:')) {
          keys.push(k);
        }
      }
      for (const k of keys) {
        ls.removeItem(k);
      }
    } catch {}
  }
}
