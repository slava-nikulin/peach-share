import { Mutex } from 'async-mutex';
import { type FirebaseApp, type FirebaseOptions, getApps, initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import {
  type Auth,
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  inMemoryPersistence,
  initializeAuth,
  indexedDBLocalPersistence,
  setPersistence,
  signInAnonymously,
} from 'firebase/auth';
import {
  connectDatabaseEmulator,
  type Database,
  getDatabase,
  goOffline,
  goOnline,
} from 'firebase/database';

type AppCheckDebugGlobal = typeof globalThis & {
  FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean;
};

export class FirebaseCore {
  static readonly instance = new FirebaseCore();

  private app!: FirebaseApp;
  private auth!: Auth;
  private db!: Database;

  private initPromise?: Promise<void>;
  private readonly rtdbMutex = new Mutex();

  private constructor() {}

  init(env: ImportMetaEnv) {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const useEmulators = env.VITE_USE_EMULATORS === 'true';

      const firebaseConfig: FirebaseOptions = {
        apiKey: env.VITE_FIREBASE_API_KEY || 'dev-key',
        projectId: env.VITE_FIREBASE_PROJECT_ID || 'demo',
        appId: env.VITE_FIREBASE_APP_ID || 'demo-app',
        authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'localhost',
        databaseURL: env.VITE_FIREBASE_DATABASE_URL,
      };

      this.app = getApps()[0] ?? initializeApp(firebaseConfig);

      if (!useEmulators) {
        const siteKey = env.VITE_APPCHECK_SITEKEY;
        const debugToken = env.VITE_APPCHECK_DEBUG_TOKEN;

        if (import.meta.env.DEV && debugToken && typeof self !== 'undefined') {
          (self as AppCheckDebugGlobal).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken; // debug token [web:253]
        }

        if (siteKey) {
          initializeAppCheck(this.app, {
            provider: new ReCaptchaV3Provider(siteKey),
            isTokenAutoRefreshEnabled: true,
          });
        }
      }

      // Auth init (+ emulator quirks)
      if (useEmulators) {
        this.pruneFirebaseLocalStorage();
        this.auth = initializeAuth(this.app, { persistence: inMemoryPersistence });
        const host = (env.VITE_EMULATOR_HOST || location.hostname).trim();
        const port = Number(env.VITE_EMULATOR_AUTH_PORT || 9099);
        connectAuthEmulator(this.auth, `http://${host}:${port}`, { disableWarnings: true });
      } else {
        this.auth = getAuth(this.app);
        await setPersistence(this.auth, indexedDBLocalPersistence).catch(() =>
          setPersistence(this.auth, browserLocalPersistence),
        );
      }

      if (!this.auth.currentUser) {
        await signInAnonymously(this.auth); // anonymous sign-in [page:0]
      }

      // RTDB init (+ emulator quirks)
      this.db = this.createDatabase(env);

      // По умолчанию держим RTDB offline до операций. [web:223]
      goOffline(this.db);
    })();

    return this.initPromise;
  }

  private createDatabase(env: ImportMetaEnv): Database {
    const useEmulators = env.VITE_USE_EMULATORS === 'true';
    if (!useEmulators) return getDatabase(this.app);

    // Важно: в dev иногда помогает убрать старые "firebase:*" записи,
    // чтобы не залипнуть на старом origin/namespace.
    this.pruneFirebaseLocalStorage();

    const protocol = (typeof window !== 'undefined' && window.location?.protocol) || 'http:';
    const hostname = (
      env.VITE_EMULATOR_HOST ||
      (typeof window !== 'undefined' ? window.location.hostname : '') ||
      '127.0.0.1'
    ).trim();

    // RTDB emulator по умолчанию на 9000 (http). [web:271]
    // Если у тебя есть https-прокси, можешь прокинуть 9443 (или любой другой) через env.
    const defaultPort = protocol === 'https:' ? 9443 : 9000;
    const port = Number(env.VITE_EMULATOR_RTDB_PORT ?? defaultPort);

    // `ns` параметр нужен для RTDB URL, как в официальных примерах. [web:247]
    const projectId = env.VITE_FIREBASE_PROJECT_ID || 'demo';
    const ns = env.VITE_EMULATOR_RTD_NS || `${projectId}`;

    const origin = `${protocol}//${hostname}:${port}`;
    const dbUrl = ns ? `${origin}?ns=${encodeURIComponent(ns)}` : origin;

    const db = getDatabase(this.app, dbUrl);

    try {
      connectDatabaseEmulator(db, hostname, port);
    } catch (e) {
      console.warn('[FirebaseCore] connectDatabaseEmulator failed:', e);
    }

    // ВАЖНО: workaround для ситуации "страница https + эмулятор",
    // когда SDK/браузер не дают нормально поднять соединение.
    // Это private/internal поле, может сломаться при обновлении SDK. [web:266]
    if (env.VITE_USE_LOCAL_SECURED_CONTEXT === 'true' && protocol === 'https:') {
      this.forceSecureRepo(db);
    }

    return db;
  }

  private pruneFirebaseLocalStorage(): void {
    if (typeof window === 'undefined') return;
    try {
      const ls = window.localStorage;
      const keys: string[] = [];
      for (let i = 0; i < ls.length; i += 1) {
        const k = ls.key(i);
        if (k?.startsWith('firebase:')) keys.push(k);
      }
      for (const k of keys) ls.removeItem(k);
    } catch {}
  }

  private forceSecureRepo(db: Database): void {
    type RepoInfoCarrier = Database & { _repo?: { repoInfo_?: { secure?: boolean } } };
    try {
      const candidate = db as RepoInfoCarrier;
      const repoInfo = candidate._repo?.repoInfo_;
      if (repoInfo) repoInfo.secure = true;
    } catch (e) {
      console.warn('[FirebaseCore] forceSecureRepo failed:', e);
    }
  }

  get database(): Database {
    if (!this.db) throw new Error('FirebaseCore not initialized');
    return this.db;
  }

  async withOnline<T>(fn: (db: Database) => Promise<T>): Promise<T> {
    return this.rtdbMutex.runExclusive(async () => {
      const db = this.database;
      goOnline(db);
      try {
        return await fn(db);
      } finally {
        goOffline(db);
      }
    });
  }
}
