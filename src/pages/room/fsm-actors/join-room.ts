// src/pages/room/fsm-actors/join-room.ts
import {
  type DatabaseReference,
  get,
  onValue,
  ref,
  runTransaction,
  serverTimestamp,
} from 'firebase/database';
import { db } from '../config/firebase';
import type { RoomRecord } from './type';

async function waitForRoomExists(roomRef: DatabaseReference, timeoutMs: number): Promise<void> {
  const snap = await get(roomRef);
  if (snap.exists()) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error('room_not_found'));
    }, timeoutMs);
    const off = onValue(
      roomRef,
      (s) => {
        if (s.exists()) {
          clearTimeout(timer);
          off();
          resolve();
        }
      },
      (e) => {
        clearTimeout(timer);
        off();
        reject(e);
      },
    );
  });
}

export async function joinRoom(input: {
  roomId: string;
  authId: string;
  timeoutMs?: number;
}): Promise<RoomRecord> {
  const { roomId, authId, timeoutMs = 15_000 } = input;
  const roomRef = ref(db, `rooms/${roomId}`);

  await waitForRoomExists(roomRef, timeoutMs).catch((e) => {
    if ((e as Error).message === 'room_not_found') throw e;
    throw new Error('room_wait_failed');
  });

  const res = await runTransaction(
    roomRef,
    (cur: RoomRecord | null) => {
      if (cur === null) return cur;
      if (cur.guestId === authId) return { ...cur, updated_at: serverTimestamp() };
      if (cur.guestId && cur.guestId !== authId) return cur;
      return { ...cur, guestId: authId, updated_at: serverTimestamp() };
    },
    { applyLocally: false },
  );

  const after = res.snapshot.val() as RoomRecord | null;
  if (!after) throw new Error('room_missing');
  if (after.guestId === authId) return after;
  if (after.guestId && after.guestId !== authId) throw new Error('room_full');
  if (!res.committed) throw new Error('join_conflict');
  throw new Error('join_unknown_state');
}
