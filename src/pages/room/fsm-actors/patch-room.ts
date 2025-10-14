import { ref, runTransaction, serverTimestamp } from 'firebase/database';
import { db } from '../config/firebase';
import type { RoomRecord } from './type';

export async function patchRoom(roomId: string, patch: Partial<RoomRecord>): Promise<RoomRecord> {
  const roomRef = ref(db, `rooms/${roomId}`);
  const res = await runTransaction(
    roomRef,
    (cur: RoomRecord | null) => {
      if (cur === null) return cur;
      return { ...cur, ...patch, updated_at: serverTimestamp() };
    },
    { applyLocally: false },
  );
  if (!res.committed) throw new Error('patch_conflict');
  return res.snapshot.val() as RoomRecord;
}
