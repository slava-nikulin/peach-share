/** biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: <explanation> */
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ref, remove, set } from 'firebase/database';
import { describe, expect, it } from 'vitest';
import { getTestEnv, waitForRoom } from '../../../../tests/setup/integration-firebase';

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

    // Пользователь не может создать /rooms напрямую
    await assertFails(
      set(ref(userDb, `/rooms/${roomId}_illegal`), { created_by: uid, created_at: Date.now() }),
    );
  });
});

describe('security rules invariants (requests + rooms)', () => {
  it('cannot create request under another uid; can create only under own uid', async () => {
    const env = getTestEnv();
    const uidA = `uA_${Math.random().toString(16).slice(2, 10)}`;
    const uidB = `uB_${Math.random().toString(16).slice(2, 10)}`;
    const roomId = `r_${Math.random().toString(16).slice(2, 10)}`;

    const dbA = env.authenticatedContext(uidA).database();

    await assertFails(set(ref(dbA, `/${uidB}/${roomId}`), { created_at: Date.now() }));
    await assertSucceeds(set(ref(dbA, `/${uidA}/${roomId}`), { created_at: Date.now() }));
  });

  it('only created_at is allowed under /{uid}/{roomId} (no extra fields, no nested writes)', async () => {
    const env = getTestEnv();
    const uid = `u_${Math.random().toString(16).slice(2, 10)}`;
    const roomId = `r_${Math.random().toString(16).slice(2, 10)}`;
    const db = env.authenticatedContext(uid).database();

    await assertSucceeds(set(ref(db, `/${uid}/${roomId}`), { created_at: Date.now() }));

    // extra field must be rejected due to $other: false
    await assertFails(set(ref(db, `/${uid}/${roomId}`), { created_at: Date.now(), extra: 1 }));

    // direct nested write must be rejected (no .write at child path)
    await assertFails(set(ref(db, `/${uid}/${roomId}/nested`), true));
  });

  it('created_at must be approx now (reject future and too-old timestamps)', async () => {
    const env = getTestEnv();
    const uid = `u_${Math.random().toString(16).slice(2, 10)}`;
    const roomId1 = `r1_${Math.random().toString(16).slice(2, 10)}`;
    const roomId2 = `r2_${Math.random().toString(16).slice(2, 10)}`;
    const db = env.authenticatedContext(uid).database();

    // future timestamp
    await assertFails(set(ref(db, `/${uid}/${roomId1}`), { created_at: Date.now() + 60_000 }));

    // too old for "now window" (older than 10s)
    await assertFails(set(ref(db, `/${uid}/${roomId2}`), { created_at: Date.now() - 60_000 }));
  });

  it('cannot overwrite a fresh request (<2 minutes old)', async () => {
    const env = getTestEnv();
    const uid = `u_${Math.random().toString(16).slice(2, 10)}`;
    const roomId = `r_${Math.random().toString(16).slice(2, 10)}`;
    const db = env.authenticatedContext(uid).database();

    await assertSucceeds(set(ref(db, `/${uid}/${roomId}`), { created_at: Date.now() }));

    // immediate overwrite should fail (old created_at is not <= now-120000)
    await assertFails(set(ref(db, `/${uid}/${roomId}`), { created_at: Date.now() }));
  });

  it('can overwrite a stale request (>=2 minutes old)', async () => {
    const env = getTestEnv();
    const uid = `u_${Math.random().toString(16).slice(2, 10)}`;
    const roomId = `r_${Math.random().toString(16).slice(2, 10)}`;
    const db = env.authenticatedContext(uid).database();

    // Seed a stale request.
    // We cannot create it via user write because created_at must be near now.
    // So we seed via RulesTestEnvironment bypass, then test overwrite as user.
    // IMPORTANT: use testEnv.withSecurityRulesDisabled for seeding.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await set(ref(ctx.database(), `/${uid}/${roomId}`), { created_at: Date.now() - 180_000 });
    });

    // Now overwrite as user should succeed (old is stale, new created_at is near now)
    await assertSucceeds(set(ref(db, `/${uid}/${roomId}`), { created_at: Date.now() }));
  });

  it('can delete /rooms/{roomId} only if created_by == auth.uid; others cannot', async () => {
    const env = getTestEnv();
    const creator = `uC_${Math.random().toString(16).slice(2, 10)}`;
    const other = `uO_${Math.random().toString(16).slice(2, 10)}`;
    const roomId = `r_${Math.random().toString(16).slice(2, 10)}`;

    const creatorDb = env.authenticatedContext(creator).database();
    const otherDb = env.authenticatedContext(other).database();

    await assertSucceeds(set(ref(creatorDb, `/${creator}/${roomId}`), { created_at: Date.now() }));
    const room = await waitForRoom({ uid: creator, roomId });

    expect(room.created_by).toBe(creator);

    await assertFails(remove(ref(otherDb, `/rooms/${roomId}`)));
    await assertSucceeds(remove(ref(creatorDb, `/rooms/${roomId}`)));
  });

  it('can delete /{uid}/{roomId} only if uid == auth.uid; others cannot', async () => {
    const env = getTestEnv();
    const uidA = `uA_${Math.random().toString(16).slice(2, 10)}`;
    const uidB = `uB_${Math.random().toString(16).slice(2, 10)}`;
    const roomId = `r_${Math.random().toString(16).slice(2, 10)}`;

    const dbA = env.authenticatedContext(uidA).database();
    const dbB = env.authenticatedContext(uidB).database();

    await assertSucceeds(set(ref(dbA, `/${uidA}/${roomId}`), { created_at: Date.now() }));

    await assertFails(remove(ref(dbB, `/${uidA}/${roomId}`)));
    await assertSucceeds(remove(ref(dbA, `/${uidA}/${roomId}`)));
  });
});
