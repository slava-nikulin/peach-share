import { type FirebaseApp, type FirebaseOptions, getApps, initializeApp } from 'firebase/app';
import {
  type Auth,
  connectAuthEmulator,
  getAuth,
  inMemoryPersistence,
  setPersistence,
  signInAnonymously,
} from 'firebase/auth';
import type { Database } from 'firebase/database';
import { RtdbConnector } from '../../pages/room/lib/RtdbConnector';

interface FirebaseEnv {
  app: FirebaseApp;
  auth: Auth;
  db: Database;
  rtdb: RtdbConnector;
}

const env: ImportMetaEnv = import.meta.env;
const useEmulators: boolean = env.VITE_USE_EMULATORS === 'true';

const firebaseConfig: FirebaseOptions = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'dev-key',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'demo-peach-share',
  appId: env.VITE_FIREBASE_APP_ID || 'demo-app',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'localhost',
  databaseURL: env.VITE_FIREBASE_DATABASE_URL,
};

const app: FirebaseApp = getApps()[0] ?? initializeApp(firebaseConfig);
const auth: Auth = getAuth(app);
const rtdb: RtdbConnector = new RtdbConnector({ app });
const db: Database = rtdb.connect();

if (useEmulators) {
  const dbHost = env.VITE_EMULATOR_RTD_HOST || '127.0.0.1';
  const authHost = env.VITE_EMULATOR_AUTH_HOST || dbHost;
  const authPort = Number(env.VITE_EMULATOR_AUTH_PORT ?? 9099);
  try {
    connectAuthEmulator(auth, `http://${authHost}:${authPort}`, {
      disableWarnings: true,
    });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('already')) {
      console.warn('[firebaseEnv] connectAuthEmulator failed:', error);
    }
  }
} else {
  void setPersistence(auth, inMemoryPersistence).catch(() => {});
}

if (!auth.currentUser) {
  await signInAnonymously(auth).catch((error) => {
    console.warn('[firebaseEnv] anonymous auth failed:', error);
  });
}

export const firebaseEnv: FirebaseEnv = {
  app,
  auth,
  db,
  rtdb,
};
