import { signOut } from 'firebase/auth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv } from '../../../../tests/setup/env';
import { startEmu, stopEmu } from '../../../../tests/setup/testcontainers';
import type { Authenticator } from '../../fsm-actors/auth';

describe('anonAuth integration', () => {
  let cleanupEnv: { restore: () => void };
  let emu: Awaited<ReturnType<typeof startEmu>>;
  let auth: import('firebase/auth').Auth;
  let authenticator: Authenticator;

  beforeAll(async () => {
    emu = await startEmu();
    cleanupEnv = setupTestEnv({
      hostname: emu.host,
      dbPort: emu.ports.db,
      authPort: emu.ports.auth,
      stunHost: emu.stunHost ?? emu.host,
      stunPort: emu.ports.stun,
    });
    const { firebaseEnv } = await import('../../lib/firebase');
    auth = firebaseEnv.auth;
    const mod = await import('../../fsm-actors/auth');
    authenticator = mod.authenticator;
    authenticator.reset();
  }, 240_000);

  afterAll(async () => {
    try {
      await signOut(auth).catch(() => {});
    } catch {}
    cleanupEnv?.restore?.();
    await stopEmu(emu).catch(() => {});
  }, 120_000);

  it('возвращает UID', async () => {
    const uid = await authenticator.anonAuth();
    expect(typeof uid).toBe('string');
    expect(uid.length).toBeGreaterThan(0);
  }, 60_000);

  it('req deduplication', async () => {
    await signOut(auth).catch(() => {});
    authenticator.reset();

    const [u1, u2, u3] = await Promise.all([
      authenticator.anonAuth(),
      authenticator.anonAuth(),
      authenticator.anonAuth(),
    ]);
    expect(new Set([u1, u2, u3]).size).toBe(1);
  }, 60_000);

  it('после signOut() выдаёт новый UID', async () => {
    const u1 = await authenticator.anonAuth();
    await signOut(auth);
    authenticator.reset();
    const u2 = await authenticator.anonAuth();
    expect(u2).not.toBe(u1);
  }, 60_000);
});
