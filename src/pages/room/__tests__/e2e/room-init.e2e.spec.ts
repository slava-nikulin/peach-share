import { type Database, get, ref, remove } from 'firebase/database';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupFirebaseTestEnv } from '../../../../tests/helpers/env';
import { startEmu, stopEmu } from '../../../../tests/helpers/firebase-emu';
import type { RoomInitActor } from '../../room-fsm';
import type { RoomRecord } from '../../types';

type StartRoomFlow = typeof import('../../room-init').startRoomFlow;
type RoomInitSnapshot = ReturnType<RoomInitActor['getSnapshot']>;

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

    expect(errors).toHaveLength(0);

    creator.stop();
    joiner.stop();
  }, 180_000);
});
