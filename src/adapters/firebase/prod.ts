import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import {
  browserLocalPersistence,
  getAuth,
  indexedDBLocalPersistence,
  setPersistence,
  signInAnonymously,
} from 'firebase/auth';
import { forceWebSockets, getDatabase } from 'firebase/database';
import { getOrInitApp } from './shared';
import type { FirebaseRtdbConnection, ProdRtdbConfig } from './types';

type AppCheckDebugGlobal = typeof globalThis & {
  FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean;
};

export async function createProdRtdbConnection(
  cfg: ProdRtdbConfig,
): Promise<FirebaseRtdbConnection> {
  if (cfg.forceWebSockets) {
    setWebSocketsOnly();
  }

  const app = getOrInitApp(cfg.app);

  if (cfg.appCheck) {
    const { siteKey, debugToken } = cfg.appCheck;

    // Никаких env-check здесь — если composition передал debugToken, значит надо.
    if (debugToken && typeof self !== 'undefined') {
      (self as AppCheckDebugGlobal).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
    }

    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }

  const auth = getAuth(app);

  // Persistence: как у тебя, но без смешивания с "useEmulators"
  await setPersistence(auth, indexedDBLocalPersistence).catch(() =>
    setPersistence(auth, browserLocalPersistence),
  );

  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }

  const db = getDatabase(app);

  return { app, auth, db };
}

function setWebSocketsOnly(): void {
  try {
    forceWebSockets();
  } catch (e) {
    console.warn('[FirebaseRTDB] forceWebSockets failed:', e);
  }
}
