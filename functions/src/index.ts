import { initializeApp } from 'firebase-admin/app';
import { type Database, getDatabase } from 'firebase-admin/database';
import * as logger from 'firebase-functions/logger';
import { onValueWritten } from 'firebase-functions/v2/database';
import { onRequest } from 'firebase-functions/v2/https';

initializeApp();
const db: Database = getDatabase();

interface Slot {
  roomId: string;
}
type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null;

const toFiniteNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const ensureObject = (parent: JsonRecord, key: string): JsonRecord => {
  const existing = parent[key];
  if (isRecord(existing)) return existing;
  const next: JsonRecord = {};
  parent[key] = next;
  return next;
};

const cloneRecord = (value: unknown): JsonRecord | null => {
  if (!isRecord(value)) return null;
  return JSON.parse(JSON.stringify(value)) as JsonRecord;
};

export const health: ReturnType<typeof onRequest> = onRequest((_req, res) => {
  res.status(200).send('ok');
});

const STATE_CREATOR = 1;
const STATE_RESPONDER = 2;

function parseSlot(v: unknown): Slot | null {
  if (!isRecord(v)) return null;
  const roomId = v.room_id;
  if (typeof roomId !== 'string' || roomId.length === 0 || roomId.length > 128) return null;
  return { roomId };
}

function applyCreatorJoin(current: unknown, uid: string): JsonRecord | undefined {
  if (current == null) {
    return {
      meta: { state: STATE_CREATOR },
      private: { creator_uid: uid, responder_uid: null, created_at: Date.now() },
    };
  }
  if (!isRecord(current)) return;

  const privateData = ensureObject(current, 'private');
  if (privateData.creator_uid !== uid) return;

  const meta = ensureObject(current, 'meta');
  meta.state = Math.max(toFiniteNumber(meta.state), STATE_CREATOR);
  privateData.creator_uid = uid;

  if (privateData.responder_uid === undefined) privateData.responder_uid = null;

  return current;
}

function applyResponderJoin(current: unknown, uid: string): JsonRecord | undefined {
  const next = cloneRecord(current);
  if (!next) return;

  const privateData = ensureObject(next, 'private');
  const creator = privateData.creator_uid;
  if (typeof creator !== 'string' || creator.length === 0 || creator === uid) return;

  const responder = privateData.responder_uid;
  const meta = ensureObject(next, 'meta');

  if (responder == null) {
    privateData.responder_uid = uid;
    meta.state = STATE_RESPONDER;
    return next;
  }

  if (responder !== uid) return;

  meta.state = Math.max(toFiniteNumber(meta.state), STATE_RESPONDER);
  return next;
}

export const registerCreator: ReturnType<typeof onValueWritten> = onValueWritten(
  '/{uid}/create',
  async (event) => {
    const uid = String(event.params.uid);
    const after = event.data.after;
    if (!after?.exists?.()) return;

    const slot = parseSlot(after.val());
    if (!slot) return;

    const { roomId } = slot;
    const roomRef = db.ref(`/rooms/${roomId}`);

    const tx = await roomRef.transaction((cur) => applyCreatorJoin(cur, uid));

    logger.info('registerCreator', { roomId, uid, committed: tx.committed });
  },
);

export const registerResponder: ReturnType<typeof onValueWritten> = onValueWritten(
  '/{uid}/join',
  async (event) => {
    const uid = String(event.params.uid);
    const after = event.data.after;
    if (!after?.exists?.()) return;

    const slot = parseSlot(after.val());
    if (!slot) return;

    const { roomId } = slot;
    const roomRef = db.ref(`/rooms/${roomId}`);
    const preSnap = await roomRef.once('value');
    const preRoom = preSnap.exists() ? preSnap.val() : null;

    const tx = await roomRef.transaction((cur) => applyResponderJoin(cur ?? preRoom, uid));

    logger.info('registerResponder', { roomId, uid, committed: tx.committed });
  },
);

export const deleteRoomOnFinalized: ReturnType<typeof onValueWritten> = onValueWritten(
  '/rooms/{roomId}/meta/state',
  async (event) => {
    const { roomId } = event.params;

    const beforeVal = event.data.before.val();
    const afterVal = event.data.after.val();

    const after = Number(afterVal);
    if (!Number.isFinite(after) || after !== 3) return;

    const before = Number(beforeVal);
    if (Number.isFinite(before) && before === 3) return; // already finalized (idempotency)

    const roomRef = db.ref(`/rooms/${roomId}`);

    try {
      await roomRef.remove();

      logger.info('Room deleted on finalized state', { roomId });
    } catch (e) {
      // ретраи допустимы; remove() идемпотентен
      logger.error('Failed to delete room on finalized state', { roomId, err: String(e) });
      throw e;
    }
  },
);

// TODO janitor
