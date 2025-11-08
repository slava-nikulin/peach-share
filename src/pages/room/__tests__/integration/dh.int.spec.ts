import { get, ref, remove } from 'firebase/database';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { bytesEq, toBase64Url } from '../../../../lib/crypto';
import { setupTestEnv } from '../../../../tests/setup/env';
import { startEmu, stopEmu } from '../../../../tests/setup/testcontainers';
import {
  cleanupTestFirebaseUsers,
  createTestFirebaseUser,
  type TestFirebaseUserCtx,
} from '../../../../tests/utils/firebase-user';
import { createRoom } from '../../fsm-actors/create-room';
import { joinRoom } from '../../fsm-actors/join-room';

interface DHParticipantSnapshot {
  msg_b64: string;
  nonce_b64: string;
}

interface DHMacSnapshot {
  mac_b64: string;
}

interface DHSnapshot {
  owner?: DHParticipantSnapshot;
  guest?: DHParticipantSnapshot;
  mac?: {
    owner?: DHMacSnapshot;
    guest?: DHMacSnapshot;
  };
  status?: { ok?: boolean };
}

interface DHStatusSnapshot {
  error?: 'mac_mismatch' | 'peer_mac_timeout';
}

const SIX_DIGIT_REGEX = /^\d{6}$/;
const DH_ERROR_REGEX = /mac_mismatch|peer_mac_timeout/;
const PEER_TIMEOUT_REGEX = /peer_timeout/;

const toErrorMessage = (reason: unknown): string => {
  if (typeof reason === 'string') return reason;
  if (reason instanceof Error) return reason.message;
  return String(reason);
};

describe('startDH integration', () => {
  let emu: Awaited<ReturnType<typeof startEmu>>;
  let cleanupEnv: { restore: () => void };
  let startDH: typeof import('../../fsm-actors/dh').startDH;
  const activeUsers: TestFirebaseUserCtx[] = [];

  beforeAll(async () => {
    emu = await startEmu();
    cleanupEnv = setupTestEnv({
      hostname: emu.host,
      dbPort: emu.ports.db,
      authPort: emu.ports.auth,
      stunHost: emu.stunHost ?? emu.host,
      stunPort: emu.ports.stun,
    });

    await import('../../../../tests/setup/firebase');
    ({ startDH } = await import('../../fsm-actors/dh'));
  }, 240_000);

  afterEach(async () => {
    if (activeUsers.length === 0) return;
    const users = activeUsers.splice(0);
    await cleanupTestFirebaseUsers(users);
  });

  afterAll(async () => {
    cleanupEnv?.restore?.();
    if (emu) {
      await stopEmu(emu);
    }
  }, 120_000);

  it('owner & guest получают одинаковые enc_key и SAS; артефакты в RTDB на месте', async () => {
    const roomId = `dh-${Date.now()}`;
    // фиксированный S для детерминированного SAS
    const sharedS = toBase64Url(new Uint8Array(32).fill(1));

    const ownerCtx = await createTestFirebaseUser('owner');
    const guestCtx = await createTestFirebaseUser('guest');
    activeUsers.push(ownerCtx, guestCtx);

    await createRoom({ roomId, authId: ownerCtx.uid, rtdb: ownerCtx.rtdb });
    await joinRoom({ roomId, authId: guestCtx.uid, rtdb: guestCtx.rtdb });

    const [owner, guest] = await Promise.all([
      startDH({ roomId, role: 'owner', sharedS, timeoutMs: 10_000, rtdb: ownerCtx.rtdb }),
      startDH({ roomId, role: 'guest', sharedS, timeoutMs: 10_000, rtdb: guestCtx.rtdb }),
    ]);

    // ключи одинаковы
    expect(bytesEq(owner.enc_key, guest.enc_key)).toBe(true);
    expect(owner.enc_key.length).toBe(32);
    // SAS совпадают и 6 цифр
    expect(owner.sas).toMatch(SIX_DIGIT_REGEX);
    expect(guest.sas).toBe(owner.sas);

    // артефакты в RTDB
    const snap = await get(ref(ownerCtx.db, `rooms/${roomId}/dh`));
    expect(snap.exists()).toBe(true);
    const dh = snap.val() as DHSnapshot;
    expect(typeof dh.owner?.msg_b64).toBe('string');
    expect(typeof dh.owner?.nonce_b64).toBe('string');
    expect(typeof dh.guest?.msg_b64).toBe('string');
    expect(typeof dh.guest?.nonce_b64).toBe('string');
    expect(typeof dh.mac?.owner?.mac_b64).toBe('string');
    expect(typeof dh.mac?.guest?.mac_b64).toBe('string');
    expect(dh.status?.ok).toBe(true);

    await remove(ref(ownerCtx.db, `rooms/${roomId}`));
  }, 60_000);

  it('mac_mismatch при разных секретах', async () => {
    const roomId = `dh-${Date.now()}-bad`;
    const sA = toBase64Url(new Uint8Array(32).fill(2));
    const sB = toBase64Url(new Uint8Array(32).fill(3));

    const ownerCtx = await createTestFirebaseUser('owner');
    const guestCtx = await createTestFirebaseUser('guest');
    activeUsers.push(ownerCtx, guestCtx);

    await createRoom({ roomId, authId: ownerCtx.uid, rtdb: ownerCtx.rtdb });
    await joinRoom({ roomId, authId: guestCtx.uid, rtdb: guestCtx.rtdb });

    const res = await Promise.allSettled([
      startDH({ roomId, role: 'owner', sharedS: sA, timeoutMs: 8_000, rtdb: ownerCtx.rtdb }),
      startDH({ roomId, role: 'guest', sharedS: sB, timeoutMs: 8_000, rtdb: guestCtx.rtdb }),
    ]);

    // хотя бы один упал с mac_mismatch
    expect(
      res.some((r) => r.status === 'rejected' && DH_ERROR_REGEX.test(toErrorMessage(r.reason))),
    ).toBe(true);

    const snap = await get(ref(ownerCtx.db, `rooms/${roomId}/dh/status`));
    if (snap.exists()) {
      const status = snap.val() as DHStatusSnapshot;
      if (status.error) {
        expect(['mac_mismatch', 'peer_mac_timeout']).toContain(status.error);
      }
    }
    await remove(ref(ownerCtx.db, `rooms/${roomId}`));
  }, 60_000);

  it('peer_timeout если второй участник не пришёл', async () => {
    const roomId = `dh-${Date.now()}-timeout`;
    const sharedS = toBase64Url(new Uint8Array(32).fill(4));
    const ownerCtx = await createTestFirebaseUser('owner');
    activeUsers.push(ownerCtx);
    await createRoom({ roomId, authId: ownerCtx.uid, rtdb: ownerCtx.rtdb });
    await expect(
      startDH({ roomId, role: 'owner', sharedS, timeoutMs: 2_000, rtdb: ownerCtx.rtdb }),
    ).rejects.toThrow(PEER_TIMEOUT_REGEX);
    await remove(ref(ownerCtx.db, `rooms/${roomId}`));
  }, 20_000);
});
