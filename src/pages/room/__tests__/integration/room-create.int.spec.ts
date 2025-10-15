import { type Database, get, ref, remove } from 'firebase/database';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupFirebaseTestEnv } from '../../../../tests/helpers/env';
import { startEmu, stopEmu } from '../../../../tests/helpers/firebase-emu';
import type { RoomRecord } from '../../types';

describe('createRoom RTDB integration', () => {
  let db: Database;
  let emu: Awaited<ReturnType<typeof startEmu>>;
  let cleanupEnv: { restore: () => void };
  let createRoomFn: (p: { roomId: string; authId: string }) => Promise<RoomRecord>;
  const createdRoomIds: string[] = [];

  const readRoom = async (roomId: string): Promise<Record<string, unknown> | null> => {
    const snapshot = await get(ref(db, `rooms/${roomId}`));
    return snapshot.exists() ? (snapshot.val() as Record<string, unknown>) : null;
  };
  const freshRoomId = (): string => {
    const id = `room-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    createdRoomIds.push(id);
    return id;
  };

  beforeAll(async () => {
    emu = await startEmu();
    cleanupEnv = setupFirebaseTestEnv({ hostname: emu.host, dbPort: emu.ports.db });

    ({ createRoom: createRoomFn } = await import('../../fsm-actors/create-room'));
    ({ db } = await import('../../config/firebase'));
  }, 240_000);

  afterEach(async () => {
    if (!db || createdRoomIds.length === 0) return;
    const ids = createdRoomIds.splice(0);
    await Promise.all(ids.map((roomId) => remove(ref(db, `rooms/${roomId}`))));
  });

  afterAll(async () => {
    cleanupEnv?.restore?.();
    await stopEmu(emu.env);
  });

  it('creates a room record with owner metadata', async () => {
    const roomId = freshRoomId();
    const authId = `user-${Math.random().toString(16).slice(2, 8)}`;
    await createRoomFn({ roomId, authId });

    const stored = await readRoom(roomId);
    expect(stored).not.toBeNull();
    expect(stored?.owner).toBe(authId);
    expect(stored?.room_id).toBe(roomId);
    expect(typeof stored?.created_at).toBe('number');
    expect(typeof stored?.updated_at).toBe('number');
    expect(stored?.created_at).toBe(stored?.updated_at);
  }, 60_000);

  it('keeps existing data and rejects duplicate creations', async () => {
    const roomId = freshRoomId();
    const authId = `owner-${Math.random().toString(16).slice(2, 8)}`;

    await createRoomFn({ roomId, authId });
    const original = await readRoom(roomId);
    expect(original).not.toBeNull();

    await expect(createRoomFn({ roomId, authId })).rejects.toThrowError('room_already_exists');

    const updated = await readRoom(roomId);
    expect(updated).toEqual(original);
  }, 60_000);

  it('returns RoomRecord on create', async () => {
    const roomId = freshRoomId();
    const authId = `user-${Math.random().toString(16).slice(2, 8)}`;
    const room = await createRoomFn({ roomId, authId });
    expect(room.room_id).toBe(roomId);
    expect(room.owner).toBe(authId);
    expect(Number(room.created_at)).toBeGreaterThan(0);
    expect(Number(room.updated_at)).toBe(Number(room.created_at));
  });
});
