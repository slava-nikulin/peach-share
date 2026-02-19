import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { onValueWritten } from 'firebase-functions/v2/database';
import { onRequest } from 'firebase-functions/v2/https';

admin.initializeApp();

export const health = onRequest((req, res) => {
  res.status(200).send('ok');
});

const STATE_CREATOR = 1;
const STATE_RESPONDER = 2;

function parseSlot(v: any): { roomId: string } | null {
  const roomId = v?.room_id;
  if (typeof roomId !== 'string' || roomId.length === 0 || roomId.length > 128) return null;
  return { roomId };
}

export const registerCreator = onValueWritten('/{uid}/create', async (event) => {
  const uid = String(event.params.uid);
  const after = (event.data as any).after;
  if (!after?.exists?.()) return;

  const slot = parseSlot(after.val());
  if (!slot) return;

  const { roomId } = slot;
  const roomRef = admin.database().ref(`/rooms/${roomId}`);

  const tx = await roomRef.transaction((cur: any) => {
    if (cur == null) {
      return {
        meta: { state: STATE_CREATOR },
        private: { creator_uid: uid, responder_uid: null, created_at: Date.now() },
      };
    }

    const creator = cur?.private?.creator_uid;
    if (creator === uid) {
      // Идемпотентно: только гарантируем state и обязательные поля,
      // но created_at НЕ трогаем
      cur.meta = cur.meta ?? {};
      cur.meta.state = Math.max(Number(cur.meta.state ?? 0), STATE_CREATOR);

      cur.private = cur.private ?? {};
      cur.private.creator_uid = uid;

      if (cur.private.responder_uid === undefined) cur.private.responder_uid = null;

      return cur;
    }

    return;
  });

  logger.info('registerCreator', { roomId, uid, committed: tx.committed });
});

export const registerResponder = onValueWritten('/{uid}/join', async (event) => {
  const uid = String(event.params.uid);
  const after = (event.data as any).after;
  if (!after?.exists?.()) return;

  const slot = parseSlot(after.val());
  if (!slot) return;

  const { roomId } = slot;
  const roomRef = admin.database().ref(`/rooms/${roomId}`);
  const preSnap = await roomRef.once('value');
  const preRoom = preSnap.exists() ? preSnap.val() : null;

  const tx = await roomRef.transaction((cur: any) => {
    const current = cur ?? preRoom;

    // join только к уже созданной комнате
    if (current == null) return;

    const next = JSON.parse(JSON.stringify(current)) as any;

    const creator = next?.private?.creator_uid;
    if (typeof creator !== 'string' || creator.length === 0) return;

    // (опционально) запретить self-join
    if (creator === uid) return;

    const responder = next?.private?.responder_uid;

    // первый wins
    if (responder == null) {
      next.private = next.private ?? {};
      next.private.responder_uid = uid;
      next.meta = next.meta ?? {};
      next.meta.state = STATE_RESPONDER;
      return next;
    }

    // идемпотентность для того же responder
    if (responder === uid) {
      next.meta = next.meta ?? {};
      next.meta.state = Math.max(Number(next.meta.state ?? 0), STATE_RESPONDER);
      return next;
    }

    // responder уже занят другим — abort
    return;
  });

  logger.info('registerResponder', { roomId, uid, committed: tx.committed });
});

export const deleteRoomOnFinalized = onValueWritten('/rooms/{roomId}/meta/state', async (event) => {
  const { roomId } = event.params;

  const beforeVal = event.data.before.val();
  const afterVal = event.data.after.val();

  const after = Number(afterVal);
  if (!Number.isFinite(after) || after !== 3) return;

  const before = Number(beforeVal);
  if (Number.isFinite(before) && before === 3) return; // already finalized (idempotency)

  const roomRef = admin.database().ref(`/rooms/${roomId}`);

  try {
    // Если хочешь чистить слоты userspace — прочитай private ДО удаления комнаты:
    // const privSnap = await admin.database().ref(`/rooms/${roomId}/private`).once('value');
    // const priv = privSnap.val() as any;
    // const creatorUid = typeof priv?.creator_uid === 'string' ? priv.creator_uid : null;
    // const responderUid = typeof priv?.responder_uid === 'string' ? priv.responder_uid : null;

    await roomRef.remove();

    // Optional cleanup (если решишь включить):
    // await Promise.allSettled([
    //   creatorUid ? admin.database().ref(`/${creatorUid}/create`).remove() : Promise.resolve(),
    //   responderUid ? admin.database().ref(`/${responderUid}/join`).remove() : Promise.resolve(),
    // ]);

    logger.info('Room deleted on finalized state', { roomId });
  } catch (e) {
    // ретраи допустимы; remove() идемпотентен
    logger.error('Failed to delete room on finalized state', { roomId, err: String(e) });
    throw e;
  }
});

// TODO janitor
