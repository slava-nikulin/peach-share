import { signOut } from 'firebase/auth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupFirebaseTestEnv } from '../../../../tests/helpers/env';
import { startEmu, stopEmu } from '../../../../tests/helpers/firebase-emu';

describe('anonAuth integration', () => {
  let cleanupEnv: { restore: () => void };
  let emu: Awaited<ReturnType<typeof startEmu>>;
  let auth: import('firebase/auth').Auth;
  let anonAuth: () => Promise<string>;

  beforeAll(async () => {
    emu = await startEmu();
    cleanupEnv = setupFirebaseTestEnv({
      hostname: emu.host,
      dbPort: emu.ports.db,
      authPort: emu.ports.auth,
    });

    // ВАЖНО: импортируем после установки env/window
    ({ auth } = await import('../../config/firebase'));
    ({ anonAuth } = await import('../../fsm-actors/auth'));
  }, 240_000);

  afterAll(async () => {
    try {
      const { auth } = await import('../../config/firebase');
      await signOut(auth).catch(() => {});
    } catch {}
    cleanupEnv?.restore?.();
    await stopEmu(emu?.env).catch(() => {});
  });

  it('возвращает UID анонимного пользователя', async () => {
    const uid = await anonAuth();
    expect(typeof uid).toBe('string');
    expect(uid.length).toBeGreaterThan(0);
  }, 60_000);

  it('дедуплицирует параллельные вызовы и возвращает один и тот же UID', async () => {
    const [u1, u2] = await Promise.all([anonAuth(), anonAuth()]);
    expect(u1).toBe(u2);
  }, 60_000);

  it('после signOut() выдает новый UID', async () => {
    const u1 = await anonAuth();
    await signOut(auth);
    const u2 = await anonAuth();
    expect(u2).not.toBe(u1);
  }, 60_000);
});
