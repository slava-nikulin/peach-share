// src/config/firebase.ts
import { type FirebaseApp, type FirebaseOptions, getApps, initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import {
  type Auth,
  connectAuthEmulator,
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
} from 'firebase/auth';
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

// demo-ProjectId для оффлайна/эмуляторов
const projectId: string = OFFLINE
  ? `demo-${env.VITE_FIREBASE_PROJECT_ID || 'webrtc-app'}`
  : env.VITE_FIREBASE_PROJECT_ID;

// Базовая конфигурация (достаточно для RTDB/Auth)
const firebaseConfig: FirebaseOptions = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'dev-key',
  projectId,
  appId: OFFLINE ? 'demo-app' : env.VITE_FIREBASE_APP_ID,
  ...(OFFLINE ? {} : { databaseURL: env.VITE_FIREBASE_DATABASE_URL }),
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

export const auth: Auth = getAuth(app);
export const db: Database = getDatabase(app);

// Подключение к эмуляторам ДО любых операций
if (USE_EMU || OFFLINE) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const pageHost = window.location.hostname;
  const emuHost =
    env.VITE_EMULATOR_RTD_HOST ||
    (pageHost === 'localhost' || pageHost === '127.0.0.1' || pageHost === '::1'
      ? '127.0.0.1'
      : pageHost);
  const emuPort = Number(env.VITE_EMULATOR_RTD_PORT || 9000);
  connectDatabaseEmulator(db, emuHost, emuPort);
}

// Утилита: обеспечить анонимный вход и вернуть uid
let ensureAnonPromise: Promise<string> | null = null;
export function ensureAnon(): Promise<string> {
  if (auth.currentUser?.uid) return Promise.resolve(auth.currentUser.uid);
  if (ensureAnonPromise) return ensureAnonPromise;

  ensureAnonPromise = new Promise<string>((resolve, reject) => {
    const unsub = onAuthStateChanged(
      auth,
      (u) => {
        if (u?.uid) {
          unsub();
          resolve(u.uid);
        }
      },
      (err) => {
        unsub();
        reject(err);
      },
    );
    const performSignIn = async (): Promise<void> => {
      try {
        if (!auth.currentUser) {
          await signInAnonymously(auth);
        }
      } catch (e) {
        // onAuthStateChanged может сработать позже, но если signIn кинул — снимем подписку
        unsub();
        reject(e);
      }
    };
    void performSignIn();
  }).finally(() => {
    ensureAnonPromise = null;
  });

  return ensureAnonPromise;
}

// Подписка на статус подключения RTDB через /.info/connected
// Возвращает функцию отписки; колбэк получает boolean
export function rtdbConnectedSubscribe(
  database: Database,
  cb: (connected: boolean) => void,
): () => void {
  const infoRef = ref(database, '/.info/connected');
  return onValue(infoRef, (snap) => cb(Boolean(snap.val())));
}
