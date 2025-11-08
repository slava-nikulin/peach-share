import type { Database } from 'firebase/database';
import { get, ref } from 'firebase/database';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv } from '../../../../tests/setup/env';
import { startEmu, stopEmu } from '../../../../tests/setup/testcontainers';
import {
  cleanupTestFirebaseUsers,
  createTestFirebaseUser,
  type TestFirebaseUserCtx,
} from '../../../../tests/utils/firebase-user';
import { createRoom } from '../../fsm-actors/create-room';
import { joinRoom } from '../../fsm-actors/join-room';
import type { RoomRecord } from '../../types';

describe('joinRoom RTDB integration', () => {
  let emu: Awaited<ReturnType<typeof startEmu>>;
  let cleanupEnv: { restore: () => void };

  const activeContexts: TestFirebaseUserCtx[] = [];

  const read = async (database: Database, roomId: string): Promise<RoomRecord | null> => {
    const s = await get(ref(database, `rooms/${roomId}`));
    return s.exists() ? (s.val() as RoomRecord) : null;
  };
  const rid = (): string => `room-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  beforeAll(async () => {
    emu = await startEmu();
    cleanupEnv = setupTestEnv({
      hostname: emu.host,
      dbPort: emu.ports.db,
      authPort: emu.ports.auth,
      stunHost: emu.stunHost ?? emu.host,
      stunPort: emu.ports.stun,
    });

    await import('../../lib/firebase');
  }, 240_000);

  afterEach(async () => {
    if (activeContexts.length === 0) return;
    const contexts = activeContexts.splice(0);
    await cleanupTestFirebaseUsers(contexts);
  });

  afterAll(async () => {
    cleanupEnv?.restore?.();
    if (emu) {
      await stopEmu(emu);
    }
  }, 120_000);

  it('подключает гостя к уже созданной комнате', async () => {
    const roomId = rid();
    const ownerCtx = await createTestFirebaseUser('owner');
    const guestCtx = await createTestFirebaseUser('guest');
    activeContexts.push(ownerCtx, guestCtx);

    await createRoom({ roomId, authId: ownerCtx.uid }, { db: ownerCtx.db });
    await joinRoom({ roomId, authId: guestCtx.uid }, { db: guestCtx.db });

    const r = await read(ownerCtx.db, roomId);
    expect(r).not.toBeNull();
    expect(r?.owner).toBe(ownerCtx.uid);
    expect(r?.guest).toBe(guestCtx.uid);
    // updated_at должен измениться после join
    expect(Number(r?.updated_at)).toBeGreaterThanOrEqual(Number(r?.created_at));
  }, 60_000);

  it('идемпотентно: повторный join тем же пользователем не падает', async () => {
    const roomId = rid();
    const ownerCtx = await createTestFirebaseUser('owner');
    const guestCtx = await createTestFirebaseUser('guest');
    activeContexts.push(ownerCtx, guestCtx);

    await createRoom({ roomId, authId: ownerCtx.uid }, { db: ownerCtx.db });
    await joinRoom({ roomId, authId: guestCtx.uid }, { db: guestCtx.db });
    await joinRoom({ roomId, authId: guestCtx.uid }, { db: guestCtx.db }); // не должен бросать

    const r = await read(ownerCtx.db, roomId);
    expect(r?.guest).toBe(guestCtx.uid);
  }, 60_000);

  it('ошибка если комната занята другим гостем', async () => {
    const roomId = rid();
    const ownerCtx = await createTestFirebaseUser('owner');
    const guest1Ctx = await createTestFirebaseUser('g1');
    const guest2Ctx = await createTestFirebaseUser('g2');
    activeContexts.push(ownerCtx, guest1Ctx, guest2Ctx);

    await createRoom({ roomId, authId: ownerCtx.uid }, { db: ownerCtx.db });
    await joinRoom({ roomId, authId: guest1Ctx.uid }, { db: guest1Ctx.db });

    await expect(
      joinRoom({ roomId, authId: guest2Ctx.uid }, { db: guest2Ctx.db }),
    ).rejects.toThrowError('room_full');
  }, 60_000);

  it('ждет создания комнаты до таймаута и падает, если не создана', async () => {
    const roomId = rid();
    const guestCtx = await createTestFirebaseUser('guest');
    activeContexts.push(guestCtx);

    await expect(
      joinRoom({ roomId, authId: guestCtx.uid, timeoutMs: 300 }, { db: guestCtx.db }),
    ).rejects.toThrowError('room_not_found');
  }, 60_000);

  it('если комната создается чуть позже, join успевает', async () => {
    const roomId = rid();
    const guestCtx = await createTestFirebaseUser('guest');
    activeContexts.push(guestCtx);

    const pJoin = joinRoom({ roomId, authId: guestCtx.uid, timeoutMs: 5_000 }, { db: guestCtx.db });

    await new Promise((r) => setTimeout(r, 150)); // имитируем задержку создания
    const ownerCtx = await createTestFirebaseUser('owner');
    activeContexts.push(ownerCtx);
    await createRoom({ roomId, authId: ownerCtx.uid }, { db: ownerCtx.db });

    await pJoin; // не должен упасть
    const r = await read(ownerCtx.db, roomId);
    expect(r?.owner).toBe(ownerCtx.uid);
    expect(r?.guest).toBe(guestCtx.uid);
  }, 60_000);

  it('returns RoomRecord on join', async () => {
    const roomId = rid();
    const ownerCtx = await createTestFirebaseUser('owner');
    const guestCtx = await createTestFirebaseUser('guest');
    activeContexts.push(ownerCtx, guestCtx);

    await createRoom({ roomId, authId: ownerCtx.uid }, { db: ownerCtx.db });
    const joined = await joinRoom({ roomId, authId: guestCtx.uid }, { db: guestCtx.db });
    expect(joined.room_id).toBe(roomId);
    expect(joined.owner).toBe(ownerCtx.uid);
    expect(joined.guest).toBe(guestCtx.uid);
  });
});
