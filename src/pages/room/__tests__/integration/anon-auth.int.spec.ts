import { signOut } from 'firebase/auth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv } from '../../../../tests/setup/env';
import { startEmu, stopEmu } from '../../../../tests/setup/testcontainers';

describe('anonAuth integration', () => {
  let cleanupEnv: { restore: () => void };
  let emu: Awaited<ReturnType<typeof startEmu>>;
  let auth: import('firebase/auth').Auth;
  let anonAuth: (timeoutMs?: number) => Promise<string>;
  let resetAnonAuthCache: () => void;

  beforeAll(async () => {
    emu = await startEmu();
    cleanupEnv = setupTestEnv({
      hostname: emu.host,
      dbPort: emu.ports.db,
      authPort: emu.ports.auth,
      stunHost: emu.stunHost ?? emu.host,
      stunPort: emu.ports.stun,
    });
    const { firebaseEnv } = await import('../../config/firebase');
    auth = firebaseEnv.auth;
    const mod = await import('../../fsm-actors/auth');
    anonAuth = mod.anonAuth;
    resetAnonAuthCache = mod.resetAnonAuthCache;
  }, 240_000);

  afterAll(async () => {
    try {
      await signOut(auth).catch(() => {});
    } catch {}
    cleanupEnv?.restore?.();
    await stopEmu(emu).catch(() => {});
  }, 120_000);

  it('возвращает UID', async () => {
    const uid = await anonAuth();
    expect(typeof uid).toBe('string');
    expect(uid.length).toBeGreaterThan(0);
  }, 60_000);

  it('req deduplication', async () => {
    await signOut(auth).catch(() => {});
    resetAnonAuthCache();

    const [u1, u2, u3] = await Promise.all([anonAuth(), anonAuth(), anonAuth()]);
    expect(new Set([u1, u2, u3]).size).toBe(1);
  }, 60_000);

  it('после signOut() выдаёт новый UID', async () => {
    const u1 = await anonAuth();
    await signOut(auth);
    resetAnonAuthCache();
    const u2 = await anonAuth();
    expect(u2).not.toBe(u1);
  }, 60_000);
});
