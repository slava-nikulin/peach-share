import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

const mockAuth = { currentUser: null } as unknown as import('firebase/auth').Auth;

vi.mock('../config/firebase', () => ({
  getRoomFirebaseEnv: () => ({
    auth: mockAuth,
  }),
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
  let authenticator: import('../../fsm-actors/auth').Authenticator;
  let fbAuth: typeof import('firebase/auth');

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    fbAuth = await import('firebase/auth');
    const mod = await import('../../fsm-actors/auth');
    authenticator = mod.authenticator;
    authenticator.reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('auth_timeout', async () => {
    const p = authenticator.anonAuth(50);
    const handled = p.catch((e) => e);
    await vi.advanceTimersByTimeAsync(60);
    const err = await handled;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('auth_timeout');
  });

  it('deduplication: один signInAnonymously на несколько вызовов', async () => {
    const p = Promise.all([
      authenticator.anonAuth(50),
      authenticator.anonAuth(50),
      authenticator.anonAuth(50),
    ]);
    const handled = p.catch((e) => e);
    await vi.advanceTimersByTimeAsync(60);
    await expect(handled).resolves.toMatchObject({ message: 'auth_timeout' });
    expect(fbAuth.signInAnonymously as Mock).toHaveBeenCalledTimes(1);
  });
});
