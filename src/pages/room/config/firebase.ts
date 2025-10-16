// src/config/firebase.ts
import { type FirebaseApp, type FirebaseOptions, getApps, initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { type Auth, connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  connectDatabaseEmulator,
  type Database,
  getDatabase,
  onValue,
  ref,
} from 'firebase/database';

const env: ImportMetaEnv = import.meta.env;

// Флаги окружения
export const USE_EMU: boolean = String(env.VITE_USE_EMULATORS) === 'true';
export const OFFLINE: boolean = String(env.VITE_OFFLINE_MODE) === 'true';
const IN_EMU: boolean = USE_EMU || OFFLINE || import.meta.env.MODE === 'emu';

const projectId: string = env.VITE_FIREBASE_PROJECT_ID || 'peach-share-app';

// Базовая конфигурация (достаточно для RTDB/Auth)
const firebaseConfig: FirebaseOptions = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'dev-key',
  projectId,
  appId: OFFLINE ? 'demo-app' : env.VITE_FIREBASE_APP_ID,
  // В эмуляторе databaseURL не задаём
  ...(IN_EMU ? {} : { databaseURL: env.VITE_FIREBASE_DATABASE_URL }),
  ...(env.VITE_FIREBASE_AUTH_DOMAIN ? { authDomain: env.VITE_FIREBASE_AUTH_DOMAIN } : {}),
  ...(env.VITE_FIREBASE_STORAGE_BUCKET ? { storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET } : {}),
  ...(env.VITE_FIREBASE_MESSAGING_SENDER_ID
    ? { messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID }
    : {}),
};

const existingApp: FirebaseApp | undefined = getApps()[0];
export const app: FirebaseApp = existingApp ?? initializeApp(firebaseConfig);

// App Check включаем только онлайн (в оффлайне/эмуляторах не требуется)
if (!OFFLINE) {
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
}

// ---- Auth ----
export const auth: Auth = getAuth(app);
const EMU_AUTH: boolean = String(env.VITE_EMULATOR_AUTH ?? 'true') === 'true'; // по умолчанию в эму включаем
if (IN_EMU && EMU_AUTH) {
  const host = env.VITE_EMULATOR_AUTH_HOST || '127.0.0.1';
  const port = Number(env.VITE_EMULATOR_AUTH_PORT || 9099);
  try {
    connectAuthEmulator(auth, `http://${host}:${port}`, { disableWarnings: true });
  } catch {}
}

// ---- RTDB ----
let _db: Database;
if (IN_EMU) {
  const pageHost = window.location.hostname;
  const host =
    env.VITE_EMULATOR_RTD_HOST ||
    (pageHost === 'localhost' || pageHost === '127.0.0.1' || pageHost === '::1'
      ? '127.0.0.1'
      : pageHost);
  const port = Number(env.VITE_EMULATOR_RTD_PORT || 9000);
  const ns = env.VITE_EMULATOR_RTD_NS || `${projectId}-default-rtdb`;

  // Явно фиксируем ns и хост эмулятора
  _db = getDatabase(app, `http://${host}:${port}?ns=${ns}`);
  connectDatabaseEmulator(_db, host, port);
} else {
  _db = getDatabase(app);
}
export const db: Database = _db;

// Подписка на статус подключения RTDB через /.info/connected (без изменений)
export function rtdbConnectedSubscribe(
  database: Database,
  cb: (connected: boolean) => void,
): () => void {
  const infoRef = ref(database, '/.info/connected');
  return onValue(infoRef, (snap) => cb(Boolean(snap.val())));
}
