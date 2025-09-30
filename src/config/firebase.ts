import { getApps, initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getDatabase, connectDatabaseEmulator } from 'firebase/database';

const env = import.meta.env;
// Флаги окружения
const USE_EMU = String(env.VITE_USE_EMULATORS) === 'true';
export const OFFLINE = String(env.VITE_OFFLINE_MODE) === 'true';

const projectId = OFFLINE
  ? `demo-${env.VITE_FIREBASE_PROJECT_ID || 'webrtc-app'}`
  : env.VITE_FIREBASE_PROJECT_ID;

// Собираем только необходимые поля; остальные можно опустить, если сервисы не используются
const firebaseConfig: any = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  projectId: projectId,
  appId: OFFLINE ? 'demo-app' : env.VITE_FIREBASE_APP_ID,
  ...(OFFLINE ? {} : { databaseURL: env.VITE_FIREBASE_DATABASE_URL }),
  ...(env.VITE_FIREBASE_AUTH_DOMAIN ? { authDomain: env.VITE_FIREBASE_AUTH_DOMAIN } : {}),
  ...(env.VITE_FIREBASE_STORAGE_BUCKET ? { storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET } : {}),
  ...(env.VITE_FIREBASE_MESSAGING_SENDER_ID ? { messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID } : {}),
};

export const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

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
if (USE_EMU || OFFLINE) {
  const pageHost = window.location.hostname;
  const emuHost =
    env.VITE_EMULATOR_RTD_HOST
    || (pageHost === 'localhost' || pageHost === '127.0.0.1' || pageHost === '::1'
      ? '127.0.0.1'
      : pageHost);
  const emuPort = Number(env.VITE_EMULATOR_RTD_PORT || 9000);
  connectDatabaseEmulator(db, emuHost, emuPort);
}