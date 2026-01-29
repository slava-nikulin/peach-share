import * as admin from 'firebase-admin';
import { onValueCreated } from 'firebase-functions/v2/database';
import * as logger from 'firebase-functions/logger';

admin.initializeApp();

export const createRoomOnRequest = onValueCreated('/{uid}/{roomId}', async (event) => {
  const { uid, roomId } = event.params;

  const req = event.data.val() as { created_at?: number } | null;
  const createdAt = req?.created_at ?? Date.now();

  const roomRef = admin.database().ref(`/rooms/${roomId}`);

  // Идемпотентность (на случай повторных триггеров/ретраев)
  const snap = await roomRef.once('value');
  if (snap.exists()) {
    logger.info('Room already exists', { roomId });
    return;
  }

  await roomRef.set({
    created_by: uid,
    created_at: createdAt,
  });

  logger.info('Room created', { roomId, uid });
});
