import { type Database, get, ref, remove } from 'firebase/database';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupFirebaseTestEnv } from '../../../../tests/helpers/env';
import { startEmu, stopEmu } from '../../../../tests/helpers/firebase-emu';
import type { RoomInitActor } from '../../room-fsm';
import type { RoomRecord } from '../../types';

type StartRoomFlow = typeof import('../../room-init').startRoomFlow;
type RoomInitSnapshot = ReturnType<RoomInitActor['getSnapshot']>;
interface PakeSnapshot {
  owner: { msg_b64: string; nonce_b64: string };
  guest: { msg_b64: string; nonce_b64: string };
  mac: {
    owner: { mac_b64: string };
    guest: { mac_b64: string };
  };
  status: { ok: boolean };
}

const SIX_DIGIT_REGEX = /^\d{6}$/;

const untilDone = (actor: RoomInitActor, timeoutMs: number = 120_000): Promise<void> =>
  new Promise<void>((res, rej) => {
    let timer: ReturnType<typeof setTimeout>;
    const subscription = actor.subscribe((state: RoomInitSnapshot) => {
      if (state.status === 'done') {
        clearTimeout(timer);
        subscription.unsubscribe();
        res();
      }
    });
    timer = setTimeout(() => {
      subscription.unsubscribe();
      rej(new Error('timeout: actor did not reach done'));
    }, timeoutMs);
  });

const readRoom = async (db: Database, roomId: string): Promise<Record<string, unknown> | null> => {
  const snap = await get(ref(db, `rooms/${roomId}`));
  return snap.exists() ? (snap.val() as Record<string, unknown>) : null;
};

describe('room init e2e (concurrent)', () => {
  let db: Database;
  let emu: Awaited<ReturnType<typeof startEmu>>;
  let cleanupEnv: { restore: () => void };

  let startRoomFlow: StartRoomFlow;

  const createdRoomIds: string[] = [];

  beforeAll(async () => {
    vi.useRealTimers();
    emu = await startEmu();
    cleanupEnv = setupFirebaseTestEnv({
      hostname: emu.host,
      dbPort: emu.ports.db,
      authPort: emu.ports.auth,
    });

    vi.resetModules();

    ({ db } = await import('../../config/firebase'));
    ({ startRoomFlow } = await import('../../room-init'));
  }, 240_000);

  afterEach(async () => {
    if (!db || createdRoomIds.length === 0) return;
    const ids = createdRoomIds.splice(0);
    await Promise.all(ids.map((roomId) => remove(ref(db, `rooms/${roomId}`))));
  }, 60_000);

  afterAll(async () => {
    cleanupEnv?.restore?.();
    await stopEmu(emu.env);
  }, 60_000);

  it('create & join concurrently; both reach done; same room_id; no errors', async () => {
    const roomId = `room-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    createdRoomIds.push(roomId);

    const secret = 'e2e-secret';
    const errors: string[] = [];
    const onErr = (m: string | null): void => {
      if (m) errors.push(m);
    };

    // одновременный старт — join сам подождёт появления записи
    const creator = startRoomFlow({ roomId, intent: 'create', secret }, onErr);
    const joiner = startRoomFlow({ roomId, intent: 'join', secret }, onErr);
    const cVM = creator.vm;
    const jVM = joiner.vm;

    await Promise.all([untilDone(creator.actor), untilDone(joiner.actor)]);

    const cCtx: RoomInitSnapshot['context'] = creator.actor.getSnapshot().context;
    const jCtx: RoomInitSnapshot['context'] = joiner.actor.getSnapshot().context;

    expect(cCtx.room).toBeDefined();
    expect(jCtx.room).toBeDefined();

    const cRoom = cCtx.room as RoomRecord;
    const jRoom = jCtx.room as RoomRecord;

    expect(cRoom.room_id).toBe(roomId);
    expect(jRoom.room_id).toBe(roomId);
    expect(jRoom.owner).toBe(cRoom.owner);

    const stored = await readRoom(db, roomId);
    expect(stored?.room_id).toBe(roomId);
    expect(stored?.owner).toBe(cRoom.owner);

    // --- PAKE: проверяем результат в контексте
    expect(cCtx.encKey).toBeDefined();
    expect(jCtx.encKey).toBeDefined();
    expect(Array.from(cCtx.encKey as Uint8Array)).toEqual(Array.from(jCtx.encKey as Uint8Array));
    expect((cCtx.encKey as Uint8Array).length).toBe(32);

    expect(cCtx.sas).toBeDefined();
    expect(jCtx.sas).toBeDefined();
    expect(cCtx.sas).toMatch(SIX_DIGIT_REGEX);
    expect(cCtx.sas).toBe(jCtx.sas);

    // --- PAKE: проверяем артефакты в RTDB
    const pakePath = `rooms/${roomId}/pake`;
    const pakeSnap = await get(ref(db, pakePath));
    expect(pakeSnap.exists()).toBe(true);

    const pake = pakeSnap.val() as PakeSnapshot;

    // handshakes
    expect(typeof pake.owner?.msg_b64).toBe('string');
    expect(typeof pake.owner?.nonce_b64).toBe('string');
    expect(typeof pake.guest?.msg_b64).toBe('string');
    expect(typeof pake.guest?.nonce_b64).toBe('string');

    // macs
    expect(typeof pake.mac?.owner?.mac_b64).toBe('string');
    expect(typeof pake.mac?.guest?.mac_b64).toBe('string');
    expect(pake.mac.owner.mac_b64).not.toBe(pake.mac.guest.mac_b64); // метки A/B различны

    // статус
    expect(pake.status?.ok).toBe(true);

    //viewModel
    // Флаги пайплайна
    expect(cVM.isRoomCreated()).toBe(true);
    expect(jVM.isRoomCreated()).toBe(true);

    expect(cVM.isRtcReady()).toBe(true);
    expect(jVM.isRtcReady()).toBe(true);

    expect(cVM.isCleanupDone()).toBe(true);
    expect(jVM.isCleanupDone()).toBe(true);

    // // Auth IDs заданы и отличаются
    // expect(typeof cVM.authId()).toBe('string');
    // expect(typeof jVM.authId()).toBe('string');
    // expect(cVM.authId()).not.toBe(jVM.authId());

    // Секрет прокинут во VM
    expect(cVM.secret()).toBe(secret);
    expect(jVM.secret()).toBe(secret);

    // SAS: 6 цифр и совпадают
    expect(cVM.sas()).toMatch(SIX_DIGIT_REGEX);
    expect(jVM.sas()).toMatch(SIX_DIGIT_REGEX);
    expect(cVM.sas()).toBe(jVM.sas());

    expect(errors).toHaveLength(0);

    creator.stop();
    joiner.stop();
  }, 180_000);
});
