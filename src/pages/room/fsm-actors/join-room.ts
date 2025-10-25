// src/pages/room/fsm-actors/join-room.ts
import {
  type Database,
  type DatabaseReference,
  get,
  onValue,
  ref,
  runTransaction,
  serverTimestamp,
} from 'firebase/database';
import { firebaseEnv } from '../config/firebase';
import type { RoomRecord } from '../types';

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

interface JoinRoomDeps {
  db?: Database;
}

export async function joinRoom(
  input: {
    roomId: string;
    authId: string;
    timeoutMs?: number;
  },
  deps: JoinRoomDeps = {},
): Promise<RoomRecord> {
  const { roomId, authId, timeoutMs = 15_000 } = input;
  if (!deps.db) firebaseEnv.reconnect();
  const database = deps.db ?? firebaseEnv.db;
  const roomRef = ref(database, `rooms/${roomId}`);

  await waitForRoomExists(roomRef, timeoutMs).catch((e) => {
    if ((e as Error).message === 'room_not_found') throw e;
    throw new Error('room_wait_failed');
  });

  const res = await runTransaction(
    roomRef,
    (cur: RoomRecord | null) => {
      if (cur === null) return cur; // нет комнаты
      if (cur.guest === authId) return { ...cur, updated_at: serverTimestamp() };
      if (cur.guest && cur.guest !== authId) return cur; // занято
      return { ...cur, guest: authId, updated_at: serverTimestamp() }; // set-once
    },
    { applyLocally: false },
  ).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`joinRoom.runTransaction_failed: ${message}`, { cause: error });
  });

  const after = res.snapshot.val() as RoomRecord | null;
  if (!after) throw new Error('room_missing');
  if (after.guest === authId) return after;
  if (after.guest && after.guest !== authId) throw new Error('room_full');
  if (!res.committed) throw new Error('join_conflict');
  throw new Error('join_unknown_state');
}
