import { type Database, get, ref } from 'firebase/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupFirebaseTestEnv } from '../../../../tests/helpers/env';
import { startEmu, stopEmu } from '../../../../tests/helpers/firebase-emu';
import type { RoomRecord } from '../../types';

describe('joinRoom RTDB integration', () => {
  let emu: Awaited<ReturnType<typeof startEmu>>;
  let cleanupEnv: { restore: () => void };

  let db: Database;
  let createRoom: (p: { roomId: string; authId: string }) => Promise<RoomRecord>;
  let joinRoom: (p: { roomId: string; authId: string; timeoutMs?: number }) => Promise<RoomRecord>;

  const read = async (roomId: string): Promise<RoomRecord | null> => {
    const s = await get(ref(db, `rooms/${roomId}`));
    return s.exists() ? (s.val() as RoomRecord) : null;
  };
  const rid = (): string => `room-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  beforeAll(async () => {
    emu = await startEmu();
    cleanupEnv = setupFirebaseTestEnv({
      hostname: emu.host,
      dbPort: emu.ports.db,
      authPort: emu.ports.auth,
    });

    ({ db } = await import('../../config/firebase'));
    ({ createRoom } = await import('../../fsm-actors/create-room'));
    ({ joinRoom } = await import('../../fsm-actors/join-room'));
  }, 240_000);

  afterAll(async () => {
    cleanupEnv?.restore?.();
    await stopEmu(emu.env);
  });

  it('подключает гостя к уже созданной комнате', async () => {
    const roomId = rid();
    const owner = `owner-${Math.random().toString(16).slice(2, 6)}`;
    const guest = `guest-${Math.random().toString(16).slice(2, 6)}`;

    await createRoom({ roomId, authId: owner });
    await joinRoom({ roomId, authId: guest });

    const r = await read(roomId);
    expect(r).not.toBeNull();
    expect(r?.owner).toBe(owner);
    expect(r?.guestId).toBe(guest);
    // updated_at должен измениться после join
    expect(Number(r?.updated_at)).toBeGreaterThanOrEqual(Number(r?.created_at));
  }, 60_000);

  it('идемпотентно: повторный join тем же пользователем не падает', async () => {
    const roomId = rid();
    const owner = `o-${Math.random().toString(16).slice(2, 6)}`;
    const guest = `g-${Math.random().toString(16).slice(2, 6)}`;

    await createRoom({ roomId, authId: owner });
    await joinRoom({ roomId, authId: guest });
    await joinRoom({ roomId, authId: guest }); // не должен бросать

    const r = await read(roomId);
    expect(r?.guestId).toBe(guest);
  }, 60_000);

  it('ошибка если комната занята другим гостем', async () => {
    const roomId = rid();
    const owner = `o-${Math.random().toString(16).slice(2, 6)}`;
    const g1 = `g1-${Math.random().toString(16).slice(2, 6)}`;
    const g2 = `g2-${Math.random().toString(16).slice(2, 6)}`;

    await createRoom({ roomId, authId: owner });
    await joinRoom({ roomId, authId: g1 });

    await expect(joinRoom({ roomId, authId: g2 })).rejects.toThrowError('room_full');
  }, 60_000);

  it('ждет создания комнаты до таймаута и падает, если не создана', async () => {
    const roomId = rid();
    await expect(joinRoom({ roomId, authId: 'any', timeoutMs: 300 })).rejects.toThrowError(
      'room_not_found',
    );
  }, 60_000);

  it('если комната создается чуть позже, join успевает', async () => {
    const roomId = rid();
    const owner = `o-${Math.random().toString(16).slice(2, 6)}`;
    const guest = `g-${Math.random().toString(16).slice(2, 6)}`;

    const pJoin = joinRoom({ roomId, authId: guest, timeoutMs: 5_000 });
    await new Promise((r) => setTimeout(r, 150)); // имитируем задержку создания
    await createRoom({ roomId, authId: owner });

    await pJoin; // не должен упасть
    const r = await read(roomId);
    expect(r?.owner).toBe(owner);
    expect(r?.guestId).toBe(guest);
  }, 60_000);

  it('returns RoomRecord on join', async () => {
    const roomId = rid();
    const owner = `o-${Math.random().toString(16).slice(2, 6)}`;
    const guest = `g-${Math.random().toString(16).slice(2, 6)}`;

    await createRoom({ roomId, authId: owner });
    const joined = await joinRoom({ roomId, authId: guest });
    expect(joined.room_id).toBe(roomId);
    expect(joined.owner).toBe(owner);
    expect(joined.guestId).toBe(guest);
  });
});
