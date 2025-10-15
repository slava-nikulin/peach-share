import type { Database } from 'firebase/database';
import { get, ref, remove } from 'firebase/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bytesEq, toBase64Url } from '../../../../lib/crypto';
import { setupFirebaseTestEnv } from '../../../../tests/helpers/env';
import { startEmu, stopEmu } from '../../../../tests/helpers/firebase-emu';

interface PakeParticipantSnapshot {
  msg_b64: string;
  nonce_b64: string;
}

interface PakeMacSnapshot {
  mac_b64: string;
}

interface PakeSnapshot {
  owner?: PakeParticipantSnapshot;
  guest?: PakeParticipantSnapshot;
  mac?: {
    owner?: PakeMacSnapshot;
    guest?: PakeMacSnapshot;
  };
  status?: { ok?: boolean };
}

interface PakeStatusSnapshot {
  error?: 'mac_mismatch' | 'peer_mac_timeout';
}

const SIX_DIGIT_REGEX = /^\d{6}$/;
const PAKE_ERROR_REGEX = /mac_mismatch|peer_mac_timeout/;
const PEER_TIMEOUT_REGEX = /peer_timeout/;

const toErrorMessage = (reason: unknown): string => {
  if (typeof reason === 'string') return reason;
  if (reason instanceof Error) return reason.message;
  return String(reason);
};

describe('startPakeSession integration', () => {
  let db: Database;
  let emu: Awaited<ReturnType<typeof startEmu>>;
  let cleanupEnv: { restore: () => void };
  let startPakeSession: typeof import('../../fsm-actors/pake').startPakeSession;

  beforeAll(async () => {
    emu = await startEmu();
    cleanupEnv = setupFirebaseTestEnv({
      hostname: emu.host,
      dbPort: emu.ports.db,
      authPort: emu.ports.auth,
    });

    ({ db } = await import('../../config/firebase'));
    ({ startPakeSession } = await import('../../fsm-actors/pake'));
  }, 240_000);

  afterAll(async () => {
    cleanupEnv?.restore?.();
    await stopEmu(emu.env);
  });

  it('owner & guest получают одинаковые enc_key и SAS; артефакты в RTDB на месте', async () => {
    const roomId = `pake-${Date.now()}`;
    // фиксированный S для детерминированного SAS
    const sharedS = toBase64Url(new Uint8Array(32).fill(1));

    const [owner, guest] = await Promise.all([
      startPakeSession({ roomId, role: 'owner', sharedS, timeoutMs: 10_000 }),
      startPakeSession({ roomId, role: 'guest', sharedS, timeoutMs: 10_000 }),
    ]);

    // ключи одинаковы
    expect(bytesEq(owner.enc_key, guest.enc_key)).toBe(true);
    expect(owner.enc_key.length).toBe(32);
    // SAS совпадают и 6 цифр
    expect(owner.sas).toMatch(SIX_DIGIT_REGEX);
    expect(guest.sas).toBe(owner.sas);

    // артефакты в RTDB
    const snap = await get(ref(db, `rooms/${roomId}/pake`));
    expect(snap.exists()).toBe(true);
    const pake = snap.val() as PakeSnapshot;
    expect(typeof pake.owner?.msg_b64).toBe('string');
    expect(typeof pake.owner?.nonce_b64).toBe('string');
    expect(typeof pake.guest?.msg_b64).toBe('string');
    expect(typeof pake.guest?.nonce_b64).toBe('string');
    expect(typeof pake.mac?.owner?.mac_b64).toBe('string');
    expect(typeof pake.mac?.guest?.mac_b64).toBe('string');
    expect(pake.status?.ok).toBe(true);

    await remove(ref(db, `rooms/${roomId}`));
  }, 60_000);

  it('mac_mismatch при разных секретах', async () => {
    const roomId = `pake-${Date.now()}-bad`;
    const sA = toBase64Url(new Uint8Array(32).fill(2));
    const sB = toBase64Url(new Uint8Array(32).fill(3));

    const res = await Promise.allSettled([
      startPakeSession({ roomId, role: 'owner', sharedS: sA, timeoutMs: 8_000 }),
      startPakeSession({ roomId, role: 'guest', sharedS: sB, timeoutMs: 8_000 }),
    ]);

    // хотя бы один упал с mac_mismatch
    expect(
      res.some((r) => r.status === 'rejected' && PAKE_ERROR_REGEX.test(toErrorMessage(r.reason))),
    ).toBe(true);

    const snap = await get(ref(db, `rooms/${roomId}/pake/status`));
    if (snap.exists()) {
      const status = snap.val() as PakeStatusSnapshot;
      if (status.error) {
        expect(['mac_mismatch', 'peer_mac_timeout']).toContain(status.error);
      }
    }
    await remove(ref(db, `rooms/${roomId}`));
  }, 60_000);

  it('peer_timeout если второй участник не пришёл', async () => {
    const roomId = `pake-${Date.now()}-timeout`;
    const sharedS = toBase64Url(new Uint8Array(32).fill(4));
    await expect(
      startPakeSession({ roomId, role: 'owner', sharedS, timeoutMs: 2_000 }),
    ).rejects.toThrow(PEER_TIMEOUT_REGEX);
    await remove(ref(db, `rooms/${roomId}`));
  }, 20_000);
});
