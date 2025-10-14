import { ref, runTransaction, serverTimestamp } from 'firebase/database';
import { db } from '../config/firebase';
import type { RoomRecord } from './type';

export async function createRoom(input: { roomId: string; authId: string }): Promise<RoomRecord> {
  const roomRef = ref(db, `rooms/${input.roomId}`);
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
