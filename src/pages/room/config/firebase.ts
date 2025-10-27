import { type FirebaseApp, type FirebaseOptions, getApps, initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { type Auth, connectAuthEmulator, getAuth, initializeAuth } from 'firebase/auth';
import {
  connectDatabaseEmulator,
  type Database,
  getDatabase,
  goOffline,
  goOnline,
  onValue,
  ref,
} from 'firebase/database';

const env: ImportMetaEnv = import.meta.env;
const LOCAL_HOSTS: Set<string> = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);
const NUMERIC_IPV4_REGEX: RegExp = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const LOCAL_SERVICE_HOST_REGEX: RegExp = /^[a-zA-Z0-9-]+$/;

const currentPageHost = (): string => {
  const win = typeof window === 'undefined' ? undefined : window;
  const hostname = win?.location?.hostname;
  if (typeof hostname === 'string' && hostname.length > 0) return hostname;
  return 'localhost';
};

const isLoopbackHost = (host: string): boolean => LOCAL_HOSTS.has(host) || host.startsWith('127.');

const isNumericIp = (host: string): boolean => NUMERIC_IPV4_REGEX.test(host);

const splitHostCandidates = (raw: string | undefined): string[] => {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  return trimmed
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const toUrlHost = (candidate: string): string | null => {
  if (!candidate.startsWith('http://') && !candidate.startsWith('https://')) return null;
  try {
    return new URL(candidate).hostname;
  } catch {
    return null;
  }
};

const isAcceptableLocalHost = (host: string): boolean =>
  isLoopbackHost(host) ||
  isNumericIp(host) ||
  host.includes('.') ||
  LOCAL_SERVICE_HOST_REGEX.test(host);

const pickCandidateHost = (candidate: string, runningLocally: boolean): string | null => {
  const urlHost = toUrlHost(candidate);
  if (urlHost) {
    if (!runningLocally || isAcceptableLocalHost(urlHost)) {
      return urlHost;
    }
    return null;
  }

  if (!runningLocally) {
    return candidate;
  }

  if (isAcceptableLocalHost(candidate)) {
    return candidate;
  }

  return null;
};

const resolveEmulatorHost = (raw: string | undefined): string => {
  const pageHost = currentPageHost();
  const runningLocally = isLoopbackHost(pageHost);
  const candidates = splitHostCandidates(raw);
  const fallbackHost = runningLocally ? '127.0.0.1' : pageHost;

  for (const candidate of candidates) {
    const resolved = pickCandidateHost(candidate, runningLocally);
    if (resolved) return resolved;
  }

  return fallbackHost;
};

export { resolveEmulatorHost as __resolveEmulatorHostForTests };

export const USE_EMU: boolean = String(env.VITE_USE_EMULATORS) === 'true';
export const OFFLINE: boolean = String(env.VITE_OFFLINE_MODE) === 'true';
const IN_EMU: boolean = USE_EMU || OFFLINE || import.meta.env.MODE === 'emu';
const EMU_AUTH: boolean = String(env.VITE_EMULATOR_AUTH ?? 'true') === 'true';

const projectId: string = env.VITE_FIREBASE_PROJECT_ID || 'peach-share-app';

const firebaseConfig: FirebaseOptions = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'dev-key',
  projectId,
  appId: OFFLINE ? 'demo-app' : env.VITE_FIREBASE_APP_ID,
  ...(IN_EMU ? {} : { databaseURL: env.VITE_FIREBASE_DATABASE_URL }),
  ...(env.VITE_FIREBASE_AUTH_DOMAIN ? { authDomain: env.VITE_FIREBASE_AUTH_DOMAIN } : {}),
  ...(env.VITE_FIREBASE_STORAGE_BUCKET ? { storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET } : {}),
  ...(env.VITE_FIREBASE_MESSAGING_SENDER_ID
    ? { messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID }
    : {}),
};

export class RoomFirebaseEnvironment {
  private appInstance?: FirebaseApp;
  private appCheckConfigured = false;
  private authInstance?: Auth;
  private authEmulatorConfigured = false;
  private databaseInstance?: Database;
  private databaseEmulatorConfigured = false;
  private databaseOnline = false;

  public connect(): { app: FirebaseApp; auth: Auth; db: Database } {
    const app = this.ensureApp();
    const auth = this.ensureAuth(app);
    const db = this.ensureDatabase(app);
    this.ensureOnline(db);
    return { app, auth, db };
  }

  public reconnect(): void {
    this.databaseOnline = false;
    this.ensureOnline(this.connect().db);
  }

  public disconnect(): void {
    if (this.databaseInstance && this.databaseOnline) {
      try {
        goOffline(this.databaseInstance);
      } catch (error) {
        console.warn('Failed to goOffline for Firebase RTDB:', error);
      }
      this.databaseOnline = false;
    }
  }

  public cleanup(): void {
    this.disconnect();
    this.databaseInstance = undefined;
    this.databaseOnline = false;
    this.databaseEmulatorConfigured = false;
  }

  public get app(): FirebaseApp {
    return this.connect().app;
  }

  public get auth(): Auth {
    return this.connect().auth;
  }

  public get db(): Database {
    return this.connect().db;
  }

  private ensureApp(): FirebaseApp {
    if (this.appInstance) return this.appInstance;
    const existing = getApps()[0];
    const app = existing ?? initializeApp(firebaseConfig);
    this.configureAppCheck(app);
    this.appInstance = app;
    return app;
  }

  private configureAppCheck(app: FirebaseApp): void {
    if (this.appCheckConfigured || OFFLINE) return;
    const dbg = env.VITE_APPCHECK_DEBUG_TOKEN;
    if (import.meta.env.DEV && typeof dbg !== 'undefined') {
      const globalScope = self as typeof self & { FIREBASE_APPCHECK_DEBUG_TOKEN?: string };
      globalScope.FIREBASE_APPCHECK_DEBUG_TOKEN = dbg;
    }
    const siteKey = env.VITE_APPCHECK_SITEKEY;
    if (siteKey) {
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
    }
    this.appCheckConfigured = true;
  }

  private ensureAuth(app: FirebaseApp): Auth {
    if (this.authInstance) return this.authInstance;

    if (IN_EMU && EMU_AUTH) {
      const instance = initializeAuth(app);
      if (!this.authEmulatorConfigured) {
        try {
          const authHost = resolveEmulatorHost(env.VITE_EMULATOR_AUTH_HOST);
          const authPort = Number(env.VITE_EMULATOR_AUTH_PORT || 9099);
          connectAuthEmulator(instance, `http://${authHost}:${authPort}`, {
            disableWarnings: true,
          });
          this.authEmulatorConfigured = true;
        } catch (error) {
          console.warn('Auth emulator connection failed, falling back to production:', error);
        }
      }
      this.authInstance = instance;
      return instance;
    }

    this.authInstance = getAuth(app);
    return this.authInstance;
  }

  private ensureDatabase(app: FirebaseApp): Database {
    if (this.databaseInstance) return this.databaseInstance;

    let database: Database;
    if (IN_EMU) {
      const rtdbHost = resolveEmulatorHost(env.VITE_EMULATOR_RTD_HOST);
      const rtdbPort = Number(env.VITE_EMULATOR_RTD_PORT || 9000);
      const rtdbNamespace = env.VITE_EMULATOR_RTD_NS || `${projectId}-default-rtdb`;
      database = getDatabase(app, `http://${rtdbHost}:${rtdbPort}?ns=${rtdbNamespace}`);
      if (!this.databaseEmulatorConfigured) {
        try {
          connectDatabaseEmulator(database, rtdbHost, rtdbPort);
          this.databaseEmulatorConfigured = true;
        } catch (error) {
          console.warn('RTDB emulator connection failed, falling back to production:', error);
        }
      }
    } else {
      database = getDatabase(app);
    }

    this.databaseInstance = database;
    return database;
  }

  private ensureOnline(database: Database): void {
    if (this.databaseOnline) return;
    try {
      goOnline(database);
    } catch (error) {
      console.warn('Failed to goOnline for Firebase RTDB:', error);
    }
    this.databaseOnline = true;
  }
}

const defaultFirebaseEnv: RoomFirebaseEnvironment = new RoomFirebaseEnvironment();
let activeFirebaseEnv: RoomFirebaseEnvironment = defaultFirebaseEnv;

export const firebaseEnv: RoomFirebaseEnvironment = defaultFirebaseEnv;

export const getRoomFirebaseEnv = (): RoomFirebaseEnvironment => activeFirebaseEnv;

export const setRoomFirebaseEnv = (env: RoomFirebaseEnvironment): void => {
  activeFirebaseEnv = env;
};

export const resetRoomFirebaseEnv = (): void => {
  activeFirebaseEnv = defaultFirebaseEnv;
};

try {
  defaultFirebaseEnv.connect();
} catch (error) {
  console.warn('Initial Firebase connect failed:', error);
}

export function rtdbConnectedSubscribe(
  database: Database,
  cb: (connected: boolean) => void,
): () => void {
  const infoRef = ref(database, '/.info/connected');
  return onValue(infoRef, (snap) => cb(Boolean(snap.val())));
}
