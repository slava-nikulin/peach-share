import { type FirebaseApp, type FirebaseOptions, getApps, initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import {
  type Auth,
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
  inMemoryPersistence,
  setPersistence,
  signInAnonymously,
} from 'firebase/auth';
import {
  createContext,
  createSignal,
  onMount,
  type ParentComponent,
  Show,
  useContext,
} from 'solid-js';
import { FullscreenSpinner } from './Spinner';

interface FirebaseCore {
  app: FirebaseApp;
  auth: Auth;
}

const FirebaseCoreCtx = createContext<FirebaseCore>();

function initAppCheck(app: FirebaseApp, env: ImportMetaEnv, offline: boolean): void {
  if (offline) return;

  const siteKey = env.VITE_APPCHECK_SITEKEY;
  const dbg = env.VITE_APPCHECK_DEBUG_TOKEN;

  if (import.meta.env.DEV && dbg) {
    (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = dbg;
  }

  if (siteKey) {
    try {
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (err) {
      if (!(err as Error)?.message?.includes('already initialized')) {
        console.error('AppCheck initialization failed:', err);
      }
    }
  }
}

const HOST = window.location.hostname;
const PROTOCOL = window.location.protocol;
const NS = import.meta.env.VITE_EMULATOR_RTD_NS;
const RTDB_PORT = Number(import.meta.env.VITE_EMULATOR_RTDB_PORT || 9443);
const AUTH_PORT = Number(import.meta.env.VITE_EMULATOR_AUTH_PORT || 9444);

export const FirebaseCoreProvider: ParentComponent = (props) => {
  const env = import.meta.env;
  const useEmulator = env.VITE_USE_EMULATORS === 'true';
  const databaseURL = useEmulator
    ? `${PROTOCOL}//${HOST}:${RTDB_PORT}?ns=${NS}`
    : env.VITE_FIREBASE_DATABASE_URL;

  const firebaseConfig: FirebaseOptions = {
    apiKey: env.VITE_FIREBASE_API_KEY || 'dev-key',
    projectId: env.VITE_FIREBASE_PROJECT_ID || 'demo-peach-share',
    appId: env.VITE_FIREBASE_APP_ID || 'demo-app',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'localhost',
    databaseURL: databaseURL,
  };

  const offline = env.VITE_USE_LOCAL_SECURED_CONTEXT === 'true';
  const useAuthEmulator = useEmulator || offline;

  const app = getApps()[0] ?? initializeApp(firebaseConfig);

  let auth: Auth;
  if (useAuthEmulator) {
    auth = initEmulatorAuth(app, env);
  } else {
    auth = getAuth(app);
    void setPersistence(auth, indexedDBLocalPersistence)
      .catch(() => setPersistence(auth, browserLocalPersistence))
      .catch((err) => console.warn('Persistence setup failed:', err));
  }

  const [ready, setReady] = createSignal(false);

  onMount(() => {
    initAppCheck(app, env, offline);
    if (auth.currentUser) {
      setReady(true);
      return;
    }

    if (!auth.currentUser) {
      void signInAnonymously(auth)
        .catch((err) => {
          console.error('Anonymous sign-in failed:', err);
        })
        .finally(() => {
          setReady(true);
        });
    }
  });

  const value: FirebaseCore = { app, auth };

  return (
    <FirebaseCoreCtx.Provider value={value}>
      <Show when={ready()} fallback={<FullscreenSpinner />}>
        {props.children}
      </Show>
    </FirebaseCoreCtx.Provider>
  );
};

function initEmulatorAuth(app: FirebaseApp, _env: ImportMetaEnv) {
  const auth = initializeAuth(app, {
    persistence: [inMemoryPersistence],
  });

  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  const port = protocol === 'https:' ? AUTH_PORT : 9099;

  try {
    connectAuthEmulator(auth, `${protocol}//${hostname}:${port}`, {
      disableWarnings: true,
    });
  } catch (err) {
    if (!(err as Error)?.message?.includes('already')) {
      console.error('Failed to connect to auth emulator:', err);
    }
  }
  return auth;
}

export function useFirebaseCore(): FirebaseCore {
  const ctx = useContext(FirebaseCoreCtx);
  if (!ctx) {
    throw new Error('useFirebaseCore must be used inside <FirebaseCoreProvider>');
  }
  return ctx;
}
