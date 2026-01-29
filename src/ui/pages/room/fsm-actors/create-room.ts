import { ref, runTransaction, serverTimestamp } from 'firebase/database';
import type { RtdbConnector } from '../lib/RtdbConnector';
import type { RoomRecord } from '../types';

export async function createRoom(input: {
  roomId: string;
  authId: string;
  rtdb: RtdbConnector;
}): Promise<RoomRecord> {
  const db = input.rtdb.connect();
  input.rtdb.ensureOnline();
  const roomRef = ref(db, `rooms/${input.roomId}`);
  const now = serverTimestamp();
  const payload: RoomRecord = {
    room_id: input.roomId,
    owner: input.authId,
    created_at: now,
    updated_at: now,
  };

  console.log(`run tran ${payload.owner}`);
  const res = await runTransaction(
    roomRef,
    (cur: RoomRecord | null) => (cur !== null ? undefined : payload),
    { applyLocally: false },
  );

  console.log(`run tran done`);
  if (!res.committed) throw new Error('room_already_exists');
  return res.snapshot.val() as RoomRecord;
}
