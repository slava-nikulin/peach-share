import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getDatabase, connectDatabaseEmulator } from 'firebase/database';

const env = import.meta.env;

// Собираем только необходимые поля; остальные можно опустить, если сервисы не используются
const firebaseConfig: any = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  databaseURL: env.VITE_FIREBASE_DATABASE_URL,
};
if (env.VITE_FIREBASE_AUTH_DOMAIN) firebaseConfig.authDomain = env.VITE_FIREBASE_AUTH_DOMAIN;
if (env.VITE_FIREBASE_STORAGE_BUCKET) firebaseConfig.storageBucket = env.VITE_FIREBASE_STORAGE_BUCKET;
if (env.VITE_FIREBASE_MESSAGING_SENDER_ID) firebaseConfig.messagingSenderId = env.VITE_FIREBASE_MESSAGING_SENDER_ID;

export const app = initializeApp(firebaseConfig);

// Флаги окружения
const OFFLINE = String(env.VITE_OFFLINE_MODE) === 'true';
const USE_EMU = String(env.VITE_USE_EMULATORS) === 'true';

// App Check: в dev можно включить Debug Provider токеном, иначе ReCaptchaV3
if (!OFFLINE) {
  const dbg = env.VITE_APPCHECK_DEBUG_TOKEN;
  if (import.meta.env.DEV && typeof dbg !== 'undefined') {
    (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = dbg;
  }
  const siteKey = env.VITE_APPCHECK_SITEKEY;
  if (siteKey) {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }
}

export const db = getDatabase(app);

// Подключение к RTDB эмулятору до любых операций
if (USE_EMU) {
  const pageHost = window.location.hostname;
  const emuHost =
    env.VITE_EMULATOR_RTD_HOST
    || (pageHost === 'localhost' || pageHost === '127.0.0.1' || pageHost === '::1'
      ? '127.0.0.1'
      : pageHost);
  const emuPort = Number(env.VITE_EMULATOR_RTD_PORT || 9000);
  connectDatabaseEmulator(db, emuHost, emuPort);
}
