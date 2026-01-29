import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { get, ref, set } from 'firebase/database';
import { describe, expect, it } from 'vitest';
import { getTestEnv } from '../../../../tests/setup/integration-firebase';

async function waitForRoom(params: {
  uid: string;
  roomId: string;
  timeoutMs?: number;
  intervalMs?: number;
}) {
  const { uid, roomId, timeoutMs = 10_000, intervalMs = 100 } = params;

  const env = getTestEnv();
  const db = env.authenticatedContext(uid).database();

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const snap = await get(ref(db, `/rooms/${roomId}`));
    const val = snap.val();
    if (val) return val;
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`Room was not created within ${timeoutMs}ms: ${roomId}`);
}

describe('create room flow: /{uid}/{roomId} -> /rooms/{roomId}', () => {
  it('creates room via function trigger', async () => {
    const env = getTestEnv();

    const uid = `u_${Math.random().toString(16).slice(2, 10)}`;
    const roomId = `r_${Math.random().toString(16).slice(2, 10)}`;

    // “Пользовательский” DB-клиент, который подчиняется rules
    const userDb = env.authenticatedContext(uid).database();

    // 1) Пользователь создаёт request-узел в своём namespace
    await assertSucceeds(set(ref(userDb, `/${uid}/${roomId}`), { created_at: Date.now() }));

    // 2) Функция должна создать /rooms/{roomId}
    const room = await waitForRoom({ uid, roomId });

    expect(room).toBeTruthy();
    expect(room.created_by).toBe(uid);
    expect(typeof room.created_at).toBe('number');

    // (Опционально) 3) Пользователь не может создать /rooms напрямую
    await assertFails(
      set(ref(userDb, `/rooms/${roomId}_illegal`), { created_by: uid, created_at: Date.now() }),
    );
  });
});
