import { ref, runTransaction, serverTimestamp } from 'firebase/database';
import { db } from '../config/firebase';

interface RoomRecord {
  room_id: string;
  owner: string;
  created_at: number | object;
  updated_at: number | object;
}

export async function createRoom(input: { roomId: string; authId: string }): Promise<void> {
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
    (cur: RoomRecord | null) => {
      if (cur !== null) return;
      return payload;
    },
    { applyLocally: false },
  );

  if (!res.committed) {
    throw new Error('room_already_exists');
  }
}
