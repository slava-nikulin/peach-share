interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_DATABASE_URL: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  readonly VITE_APPCHECK_SITEKEY: string;
  readonly VITE_USE_LOCAL_SECURED_CONTEXT?: string;
  readonly VITE_USE_EMULATORS?: string;
  readonly VITE_EMULATOR_RTD_HOST?: string;
  readonly VITE_EMULATOR_RTDB_PORT?: string;
  readonly VITE_EMULATOR_RTD_SECURE_PORT?: string;
  readonly VITE_EMULATOR_AUTH?: string;
  readonly VITE_EMULATOR_AUTH_HOST?: string;
  readonly VITE_EMULATOR_AUTH_PORT?: string;
  readonly VITE_EMULATOR_AUTH_SECURE_PORT?: string;
  readonly VITE_APPCHECK_DEBUG_TOKEN?: string;
  readonly VITE_STUN_URLS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
