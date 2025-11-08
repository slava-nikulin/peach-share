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
    if (!this.db) {
      const env = import.meta.env;
      this.db = this.createDatabase(env);
    }

    this.ensureOnline();

    if (!this.db) {
      throw new Error('[RtdbConnector] Failed to initialize database instance');
    }

    return this.db;
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
    const release: Unsub = () => {
      unsub();
      this.subs = this.subs.filter((u) => u !== unsub);
    };
    return release;
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

  private createDatabase(env: ImportMetaEnv): Database {
    if (env.VITE_USE_EMULATORS === 'true') {
      return this.createEmulatorDatabase(env);
    }
    return getDatabase(this.opts.app);
  }

  private createEmulatorDatabase(env: ImportMetaEnv): Database {
    this.pruneFirebaseLocalStorage();
    const protocol = typeof window !== 'undefined' ? window.location.protocol || 'http:' : 'http:';
    const hostname =
      env.VITE_EMULATOR_RTD_HOST ||
      (typeof window !== 'undefined' ? window.location.hostname : '') ||
      '127.0.0.1';
    const defaultPort = protocol === 'https:' ? 9443 : 9000;
    const port = Number(env.VITE_EMULATOR_RTDB_PORT ?? defaultPort);
    const ns =
      env.VITE_EMULATOR_RTD_NS ||
      `${env.VITE_FIREBASE_PROJECT_ID || 'demo-peach-share'}-default-rtdb`;

    const origin = `${protocol}//${hostname}:${port}`;
    const db = getDatabase(this.opts.app, ns ? `${origin}?ns=${ns}` : origin);

    try {
      connectDatabaseEmulator(db, hostname, port);
    } catch (error) {
      console.error('[RtdbConnector] Error connecting to emulator:', error);
    }

    if (env.VITE_USE_LOCAL_SECURED_CONTEXT === 'true' && protocol === 'https:') {
      this.forceSecureRepo(db);
    }

    return db;
  }

  private forceSecureRepo(db: Database): void {
    type RepoInfoCarrier = Database & {
      _repo?: { repoInfo_?: { secure?: boolean } };
    };
    try {
      const candidate = db as RepoInfoCarrier;
      const repoInfo = candidate._repo?.repoInfo_;
      if (repoInfo) {
        repoInfo.secure = true;
      }
    } catch (error) {
      console.warn('[RtdbConnector] Warning: Could not force secure connection:', error);
    }
  }
}
