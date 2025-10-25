import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

vi.mock('../config/firebase', () => ({
  firebaseEnv: {
    auth: { currentUser: null },
  },
}));
vi.mock('firebase/auth', async (importOriginal: () => Promise<typeof import('firebase/auth')>) => {
  const actual = await importOriginal();
  return {
    ...actual,
    onAuthStateChanged: vi.fn(() => () => {}),
    signInAnonymously: vi.fn(() => new Promise(() => {})),
  };
});

describe('anonAuth timeout', () => {
  let anonAuth: (timeoutMs?: number) => Promise<string>;
  let resetAnonAuthCache: () => void;
  let fbAuth: typeof import('firebase/auth');

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    fbAuth = await import('firebase/auth');
    const mod = await import('../../fsm-actors/auth');
    anonAuth = mod.anonAuth;
    resetAnonAuthCache = mod.resetAnonAuthCache;
    resetAnonAuthCache();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('auth_timeout', async () => {
    const p = anonAuth(50);
    const handled = p.catch((e) => e);
    await vi.advanceTimersByTimeAsync(60);
    const err = await handled;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('auth_timeout');
  });

  it('deduplication: один signInAnonymously на несколько вызовов', async () => {
    const p = Promise.all([anonAuth(50), anonAuth(50), anonAuth(50)]);
    const handled = p.catch((e) => e);
    await vi.advanceTimersByTimeAsync(60);
    await expect(handled).resolves.toMatchObject({ message: 'auth_timeout' });
    expect(fbAuth.signInAnonymously as Mock).toHaveBeenCalledTimes(1);
  });
});
