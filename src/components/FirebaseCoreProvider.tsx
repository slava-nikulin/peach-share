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
  type Context,
  createContext,
  createSignal,
  onMount,
  type ParentComponent,
  type ParentProps,
  Show,
  useContext,
} from 'solid-js';
import { FullscreenSpinner } from './Spinner';

type AppCheckDebugGlobal = typeof globalThis & {
  FIREBASE_APPCHECK_DEBUG_TOKEN?: string;
};

interface FirebaseCore {
  app: FirebaseApp;
  auth: Auth;
}

const FirebaseCoreCtx: Context<FirebaseCore | undefined> = createContext<FirebaseCore | undefined>(
  undefined,
);

function initAppCheck(app: FirebaseApp, env: ImportMetaEnv, offline: boolean): void {
  if (offline) return;

  const siteKey = env.VITE_APPCHECK_SITEKEY;
  const dbg = env.VITE_APPCHECK_DEBUG_TOKEN;

  if (import.meta.env.DEV && dbg && typeof self !== 'undefined') {
    (self as AppCheckDebugGlobal).FIREBASE_APPCHECK_DEBUG_TOKEN = dbg;
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

const DEFAULT_HTTP_RTDB_PORT = 9000;
const DEFAULT_HTTPS_RTDB_PORT = 9443;
const DEFAULT_HTTP_AUTH_PORT = 9099;
const DEFAULT_HTTPS_AUTH_PORT = 9444;

const HOST: string =
  typeof window !== 'undefined' && window.location?.hostname
    ? window.location.hostname
    : 'localhost';
const PROTOCOL: string =
  typeof window !== 'undefined' && window.location?.protocol ? window.location.protocol : 'http:';

const toNumberOr = (value: string | number | undefined, fallback: number): number => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

export const FirebaseCoreProvider: ParentComponent = (props: ParentProps) => {
  const env: ImportMetaEnv = import.meta.env;
  const useEmulator = env.VITE_USE_EMULATORS === 'true';
  const emulatorHost = env.VITE_EMULATOR_RTD_HOST?.trim() || HOST;
  const rtdDefaultPort = PROTOCOL === 'https:' ? DEFAULT_HTTPS_RTDB_PORT : DEFAULT_HTTP_RTDB_PORT;
  const emulatorPort = toNumberOr(env.VITE_EMULATOR_RTDB_PORT, rtdDefaultPort);
  const ns = env.VITE_EMULATOR_RTD_NS;
  const nsQuery = ns ? `?ns=${ns}` : '';
  const databaseURL = useEmulator
    ? `${PROTOCOL}//${emulatorHost}:${emulatorPort}${nsQuery}`
    : env.VITE_FIREBASE_DATABASE_URL;
  const offline = env.VITE_USE_LOCAL_SECURED_CONTEXT === 'true';
  const useAuthEmulator = useEmulator || offline;

  const firebaseConfig: FirebaseOptions = {
    apiKey: env.VITE_FIREBASE_API_KEY || 'dev-key',
    projectId: env.VITE_FIREBASE_PROJECT_ID || 'demo-peach-share',
    appId: env.VITE_FIREBASE_APP_ID || 'demo-app',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'localhost',
    databaseURL: databaseURL,
  };

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

function initEmulatorAuth(app: FirebaseApp, env: ImportMetaEnv): Auth {
  const auth = initializeAuth(app, {
    persistence: [inMemoryPersistence],
  });

  const protocol =
    typeof window !== 'undefined' && window.location?.protocol ? window.location.protocol : 'http:';
  const hostname =
    env.VITE_EMULATOR_AUTH_HOST?.trim() ||
    env.VITE_EMULATOR_RTD_HOST?.trim() ||
    (typeof window !== 'undefined' && window.location?.hostname
      ? window.location.hostname
      : 'localhost');
  const defaultPort = protocol === 'https:' ? DEFAULT_HTTPS_AUTH_PORT : DEFAULT_HTTP_AUTH_PORT;
  const port = toNumberOr(env.VITE_EMULATOR_AUTH_PORT, defaultPort);

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
