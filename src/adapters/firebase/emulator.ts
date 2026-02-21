import type { FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  initializeAuth,
  inMemoryPersistence,
  signInAnonymously,
} from 'firebase/auth';
import {
  connectDatabaseEmulator,
  type Database,
  forceWebSockets,
  getDatabase,
} from 'firebase/database';
import { getOrInitApp } from './shared';
import type { EmulatorRtdbConfig, FirebaseRtdbConnection } from './types';

export async function createEmulatorRtdbConnection(
  cfg: EmulatorRtdbConfig,
): Promise<FirebaseRtdbConnection> {
  const { emulator } = cfg;

  const app = getOrInitApp(cfg.app);

  const auth = initializeAuth(app, { persistence: inMemoryPersistence });
  connectAuthEmulator(auth, `http://${emulator.host}:${emulator.authPort}`, {
    disableWarnings: true,
  });

  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }

  const db = createEmulatorDatabase(app, emulator);
  return { app, auth, db };
}

function createEmulatorDatabase(
  app: FirebaseApp,
  emulator: EmulatorRtdbConfig['emulator'],
): Database {
  if (emulator.forceWebSockets) {
    setWebSocketsOnly();
  }

  // В RTDB эмуляторе namespace критичен: делаем URL с ?ns=
  const origin = `${emulator.protocol}//${emulator.host}:${emulator.rtdbPort}`;
  const dbUrl = `${origin}?ns=${encodeURIComponent(emulator.namespace)}`;

  const db = getDatabase(app, dbUrl);

  try {
    connectDatabaseEmulator(db, emulator.host, emulator.rtdbPort);
  } catch (e) {
    console.warn('[FirebaseRTDB] connectDatabaseEmulator failed:', e);
  }

  if (emulator.forceSecureRepo && emulator.protocol === 'https:') {
    forceSecureRepo(db);
  }

  return db;
}

function setWebSocketsOnly(): void {
  try {
    forceWebSockets();
  } catch (e) {
    console.warn('[FirebaseRTDB] forceWebSockets failed:', e);
  }
}

function forceSecureRepo(db: Database): void {
  type RepoInfoCarrier = Database & { _repo?: { repoInfo_?: { secure?: boolean } } };

  try {
    const candidate = db as RepoInfoCarrier;
    const repoInfo = candidate._repo?.repoInfo_;
    if (repoInfo) repoInfo.secure = true;
  } catch (e) {
    console.warn('[FirebaseRTDB] forceSecureRepo failed:', e);
  }
}
