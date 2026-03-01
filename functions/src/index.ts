console.log('deploy-time PEACH_FUNCTION_REGION =', process.env.PEACH_FUNCTION_REGION);
console.log(
  'deploy-time FIREBASE_DATABASE_EMULATOR_HOST =',
  process.env.FIREBASE_DATABASE_EMULATOR_HOST,
);

import { type App, getApps, initializeApp } from 'firebase-admin/app';
import { type Database, getDatabase, getDatabaseWithUrl } from 'firebase-admin/database';
import * as logger from 'firebase-functions/logger';
import { onValueWritten } from 'firebase-functions/v2/database';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

const emulatorHost: string | undefined = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const requestedRegion: string = process.env.PEACH_FUNCTION_REGION ?? 'us-central1';
const REGION: string = emulatorHost ? 'us-central1' : requestedRegion;
console.log('deploy-time REGION =', REGION);

const projectId: string =
  process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? 'demo-peach-share';
const emulatorDatabaseUrl: string | undefined = emulatorHost
  ? `http://${emulatorHost}?ns=${projectId}`
  : undefined;

const app: App =
  getApps()[0] ??
  initializeApp(emulatorDatabaseUrl ? { projectId, databaseURL: emulatorDatabaseUrl } : undefined);
const db: Database = emulatorDatabaseUrl
  ? getDatabaseWithUrl(emulatorDatabaseUrl, app)
  : getDatabase(app);

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

export const health: ReturnType<typeof onRequest> = onRequest({ region: REGION }, (_req, res) => {
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
  { ref: '/{uid}/create', region: REGION },
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
  { ref: '/{uid}/join', region: REGION },
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
  { ref: '/rooms/{roomId}/meta/state', region: REGION },
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

export interface JanitorResult {
  cutoff: number;
  roomsDeleted: number;
  slotsDeleted: number;
  usersDeleted: number;
}

export async function runJanitorOnce(opts?: {
  maxAgeMs?: number;
  pageSize?: number;
  updateBatch?: number;
}): Promise<JanitorResult> {
  const MAX_AGE_MS = opts?.maxAgeMs ?? 60 * 60 * 1000; // 1 час
  const cutoff = Date.now() - MAX_AGE_MS;

  const PAGE_SIZE = opts?.pageSize ?? 200;
  const UPDATE_BATCH = opts?.updateBatch ?? 400;

  let roomsDeleted = 0;
  let slotsDeleted = 0;
  let usersDeleted = 0;

  const pending: Record<string, null> = {};

  const flush = async (): Promise<void> => {
    const keys = Object.keys(pending);
    if (keys.length === 0) return;
    await db.ref('/').update(pending);
    for (const k of keys) delete pending[k];
  };

  const queueDelete = (path: string, kind: 'room' | 'slot' | 'user'): void => {
    pending[path] = null;
    if (kind === 'room') roomsDeleted += 1;
    if (kind === 'slot') slotsDeleted += 1;
    if (kind === 'user') usersDeleted += 1;
  };

  // 1) rooms: delete by private/created_at <= cutoff
  {
    const snap = await db
      .ref('/rooms')
      .orderByChild('private/created_at')
      .endAt(cutoff)
      .once('value');

    snap.forEach((roomSnap) => {
      const roomId = roomSnap.key;
      if (!roomId) return;

      const v = roomSnap.val();
      const createdAt =
        isRecord(v) && isRecord(v.private) && typeof v.private.created_at === 'number'
          ? v.private.created_at
          : undefined;

      if (typeof createdAt === 'number' && createdAt <= cutoff) {
        queueDelete(`/rooms/${roomId}`, 'room');
      }
    });

    await flush();
  }

  // 2) userspace: delete old slots; delete /{uid} if nothing else left
  {
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: todo refactor
    const processUsersPage = async (startAtKey: string | null): Promise<void> => {
      let query = db.ref('/').orderByKey();
      query = startAtKey
        ? query.startAt(startAtKey).limitToFirst(PAGE_SIZE + 1)
        : query.limitToFirst(PAGE_SIZE + 1);

      const pageSnap = await query.once('value');

      const children: Array<{ key: string; val: unknown }> = [];
      pageSnap.forEach((ch) => {
        if (ch.key) children.push({ key: ch.key, val: ch.val() });
      });

      if (children.length === 0) return;

      if (startAtKey && children[0]?.key === startAtKey) children.shift();
      if (children.length === 0) return;

      for (const { key, val } of children) {
        if (key === 'rooms') continue;
        if (!isRecord(val)) continue;

        const actions: Array<'create' | 'join'> = ['create', 'join'];
        const toDeleteActions: Array<'create' | 'join'> = [];

        for (const action of actions) {
          const slot = val[action];
          if (!isRecord(slot)) continue;

          const createdAt = slot.created_at;
          if (typeof createdAt === 'number' && createdAt <= cutoff) {
            toDeleteActions.push(action);
          }
        }

        if (toDeleteActions.length === 0) continue;

        const toDeleteSet = new Set<string>(toDeleteActions);
        const remainingKeys = Object.keys(val).filter((k) => !toDeleteSet.has(k));

        if (remainingKeys.length === 0) {
          queueDelete(`/${key}`, 'user');
        } else {
          for (const action of toDeleteActions) {
            queueDelete(`/${key}/${action}`, 'slot');
          }
        }
      }

      if (Object.keys(pending).length >= UPDATE_BATCH) {
        await flush();
      }

      const nextLastKey = children.at(-1)?.key ?? null;
      if (!nextLastKey || children.length < PAGE_SIZE) return;
      await processUsersPage(nextLastKey);
    };

    await processUsersPage(null);

    await flush();
  }

  return { cutoff, roomsDeleted, slotsDeleted, usersDeleted };
}

export const janitor: ReturnType<typeof onSchedule> = onSchedule(
  { schedule: 'every day 03:00', region: REGION },
  async () => {
    const res = await runJanitorOnce();
    logger.info('janitor completed', res);
  },
);
