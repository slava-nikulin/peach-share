import { get, ref, remove } from 'firebase/database';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv } from '../../../../tests/setup/env';
import { startEmu, stopEmu } from '../../../../tests/setup/testcontainers';
import {
  cleanupTestFirebaseUsers,
  createTestFirebaseUser,
  type TestFirebaseUserCtx,
} from '../../../../tests/utils/firebase-user';

type CreateRoomFn = typeof import('../../fsm-actors/create-room').createRoom;

describe('createRoom RTDB integration', () => {
  let emu: Awaited<ReturnType<typeof startEmu>>;
  let cleanupEnv: { restore: () => void };
  let createRoomFn: CreateRoomFn;
  const roomsToCleanup: Array<{ roomId: string; ctx: TestFirebaseUserCtx }> = [];
  const activeUsers: TestFirebaseUserCtx[] = [];

  const readRoom = async (
    databaseCtx: TestFirebaseUserCtx,
    roomId: string,
  ): Promise<Record<string, unknown> | null> => {
    const snapshot = await get(ref(databaseCtx.db, `rooms/${roomId}`));
    return snapshot.exists() ? (snapshot.val() as Record<string, unknown>) : null;
  };
  const freshRoomId = (): string => {
    return `room-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  };

  beforeAll(async () => {
    emu = await startEmu();
    cleanupEnv = setupTestEnv({
      hostname: emu.host,
      dbPort: emu.ports.db,
      authPort: emu.ports.auth,
      stunHost: emu.stunHost ?? emu.host,
      stunPort: emu.ports.stun,
    });

    ({ createRoom: createRoomFn } = await import('../../fsm-actors/create-room'));
    await import('../../../../tests/setup/firebase');
  }, 240_000);

  afterEach(async () => {
    if (roomsToCleanup.length > 0) {
      const entries = roomsToCleanup.splice(0);
      await Promise.all(
        entries.map(({ roomId, ctx }) => remove(ref(ctx.db, `rooms/${roomId}`)).catch(() => {})),
      );
    }
    if (activeUsers.length > 0) {
      const users = activeUsers.splice(0);
      await cleanupTestFirebaseUsers(users);
    }
  });

  afterAll(async () => {
    cleanupEnv?.restore?.();
    if (emu) {
      await stopEmu(emu);
    }
  }, 120_000);

  it('creates a room record with owner metadata', async () => {
    const roomId = freshRoomId();
    const ownerCtx = await createTestFirebaseUser('owner');
    activeUsers.push(ownerCtx);
    roomsToCleanup.push({ roomId, ctx: ownerCtx });
    await createRoomFn({ roomId, authId: ownerCtx.uid, rtdb: ownerCtx.rtdb });

    const stored = await readRoom(ownerCtx, roomId);
    expect(stored).not.toBeNull();
    expect(stored?.owner).toBe(ownerCtx.uid);
    expect(stored?.room_id).toBe(roomId);
    expect(typeof stored?.created_at).toBe('number');
    expect(typeof stored?.updated_at).toBe('number');
    expect(stored?.created_at).toBe(stored?.updated_at);
  }, 60_000);

  it('keeps existing data and rejects duplicate creations', async () => {
    const roomId = freshRoomId();
    const ownerCtx = await createTestFirebaseUser('owner');
    activeUsers.push(ownerCtx);
    roomsToCleanup.push({ roomId, ctx: ownerCtx });

    await createRoomFn({ roomId, authId: ownerCtx.uid, rtdb: ownerCtx.rtdb });
    const original = await readRoom(ownerCtx, roomId);
    expect(original).not.toBeNull();

    await expect(
      createRoomFn({ roomId, authId: ownerCtx.uid, rtdb: ownerCtx.rtdb }),
    ).rejects.toThrowError('room_already_exists');

    const updated = await readRoom(ownerCtx, roomId);
    expect(updated).toEqual(original);
  }, 60_000);

  it('returns RoomRecord on create', async () => {
    const roomId = freshRoomId();
    const ownerCtx = await createTestFirebaseUser('owner');
    activeUsers.push(ownerCtx);
    roomsToCleanup.push({ roomId, ctx: ownerCtx });
    const room = await createRoomFn({ roomId, authId: ownerCtx.uid, rtdb: ownerCtx.rtdb });
    expect(room.room_id).toBe(roomId);
    expect(room.owner).toBe(ownerCtx.uid);
    expect(Number(room.created_at)).toBeGreaterThan(0);
    expect(Number(room.updated_at)).toBe(Number(room.created_at));
  });
});
