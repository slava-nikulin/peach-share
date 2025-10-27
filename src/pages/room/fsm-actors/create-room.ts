import { type Database, ref, runTransaction, serverTimestamp } from 'firebase/database';
import { getRoomFirebaseEnv, type RoomFirebaseEnvironment } from '../config/firebase';
import type { RoomRecord } from '../types';

interface CreateRoomDeps {
  db?: Database;
  env?: RoomFirebaseEnvironment;
}

export async function createRoom(
  input: { roomId: string; authId: string },
  deps: CreateRoomDeps = {},
): Promise<RoomRecord> {
  const env = deps.env ?? getRoomFirebaseEnv();
  if (!deps.db) env.reconnect();
  const database = deps.db ?? env.db;
  const roomRef = ref(database, `rooms/${input.roomId}`);
  const now = serverTimestamp();
  const payload: RoomRecord = {
    room_id: input.roomId,
    owner: input.authId,
    created_at: now,
    updated_at: now,
  };

  const res = await runTransaction(
    roomRef,
    (cur: RoomRecord | null) => (cur !== null ? undefined : payload),
    { applyLocally: false },
  );

  if (!res.committed) throw new Error('room_already_exists');
  return res.snapshot.val() as RoomRecord;
}
