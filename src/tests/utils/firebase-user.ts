import { deleteApp, type FirebaseApp, getApp, initializeApp } from 'firebase/app';
import { type Auth, connectAuthEmulator, getAuth, signInAnonymously, signOut } from 'firebase/auth';
import { connectDatabaseEmulator, type Database, getDatabase } from 'firebase/database';

export interface TestFirebaseUserCtx {
  app: FirebaseApp;
  auth: Auth;
  db: Database;
  uid: string;
  cleanup: () => Promise<void>;
}

const randomSuffix = (): string => Math.random().toString(16).slice(2, 10);

export async function createTestFirebaseUser(label: string = 'test'): Promise<TestFirebaseUserCtx> {
  const baseApp = getApp();
  const appName = `${label}-${randomSuffix()}`;
  const app = initializeApp(baseApp.options, appName);

  const projectId = process.env.VITE_FIREBASE_PROJECT_ID ?? 'demo-peach-share';
  const dbHost = process.env.VITE_EMULATOR_RTD_HOST ?? '127.0.0.1';
  const dbPort = Number(process.env.VITE_EMULATOR_RTDB_PORT ?? 9000);
  const authHost = process.env.VITE_EMULATOR_AUTH_HOST ?? dbHost;
  const authPort = Number(process.env.VITE_EMULATOR_AUTH_PORT ?? 9099);
  const namespace = process.env.VITE_EMULATOR_RTD_NS ?? `${projectId}-default-rtdb`;
  const dbUrl = `http://${dbHost}:${dbPort}?ns=${namespace}`;

  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${authHost}:${authPort}`, { disableWarnings: true });
  const { user } = await signInAnonymously(auth);

  const database = getDatabase(app, dbUrl);
  connectDatabaseEmulator(database, dbHost, dbPort);

  return {
    app,
    auth,
    db: database,
    uid: user.uid,
    cleanup: async () => {
      await signOut(auth).catch(() => {});
      await deleteApp(app).catch(() => {});
    },
  };
}

export async function cleanupTestFirebaseUsers(contexts: TestFirebaseUserCtx[]): Promise<void> {
  await Promise.all(contexts.map((ctx) => ctx.cleanup()));
}
