import { vi } from 'vitest';

export interface FirebaseEnvSetup {
  restore: () => void;
}

interface Opts {
  hostname: string;
  dbPort: number;
  authPort?: number;
  stunHost?: string;
  stunPort?: number;
  projectId?: string;
  extra?: Record<string, string | number | boolean>;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: test helper aggregates multiple env toggles
export function setupTestEnv(opts: Opts): FirebaseEnvSetup {
  const {
    hostname,
    dbPort,
    authPort,
    stunHost,
    stunPort,
    projectId = 'demo-peach-share',
    extra = {},
  } = opts;

  const prev = {
    FIREBASE_DATABASE_EMULATOR_HOST: process.env.FIREBASE_DATABASE_EMULATOR_HOST,
    window: (globalThis as Record<string, unknown>).window,
    self: (globalThis as Record<string, unknown>).self,
  };

  process.env.FIREBASE_DATABASE_EMULATOR_HOST = `${hostname}:${dbPort}`;

  vi.stubEnv('VITE_USE_EMULATORS', 'true');
  vi.stubEnv('VITE_OFFLINE_MODE', 'true');
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', projectId);
  vi.stubEnv('MODE', 'emu');

  vi.stubEnv('VITE_EMULATOR_RTD_HOST', hostname);
  vi.stubEnv('VITE_EMULATOR_RTD_PORT', String(dbPort));

  if (typeof authPort === 'number') {
    vi.stubEnv('VITE_EMULATOR_AUTH', 'true');
    vi.stubEnv('VITE_EMULATOR_AUTH_HOST', hostname);
    vi.stubEnv('VITE_EMULATOR_AUTH_PORT', String(authPort));
  }

  if (typeof stunPort === 'number') {
    const stunTargetHost = stunHost ?? hostname;
    vi.stubEnv('VITE_STUN_URLS', `stun:${stunTargetHost}:${stunPort}`);
  } else {
    vi.stubEnv('VITE_STUN_URLS', '');
  }

  for (const [k, v] of Object.entries(extra)) {
    vi.stubEnv(k, String(v));
  }

  const windowLike = { location: { hostname } };
  (globalThis as Record<string, unknown>).window = windowLike;
  (globalThis as Record<string, unknown>).self = windowLike;

  return {
    restore: () => {
      vi.unstubAllEnvs();
      if (typeof prev.FIREBASE_DATABASE_EMULATOR_HOST === 'undefined') {
        delete process.env.FIREBASE_DATABASE_EMULATOR_HOST;
      } else {
        process.env.FIREBASE_DATABASE_EMULATOR_HOST = prev.FIREBASE_DATABASE_EMULATOR_HOST;
      }
      if (typeof prev.window === 'undefined') delete (globalThis as Record<string, unknown>).window;
      else (globalThis as Record<string, unknown>).window = prev.window;
      if (typeof prev.self === 'undefined') delete (globalThis as Record<string, unknown>).self;
      else (globalThis as Record<string, unknown>).self = prev.self;
    },
  };
}
