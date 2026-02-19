/** biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: <explanation> */
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ref, remove, set, update } from 'firebase/database';
import { describe, expect, it } from 'vitest';
import { getTestEnv, waitForRoom } from '../../../../tests/setup/integration-firebase';

describe('create room flow: /{uid}/{roomId} -> /rooms/{roomId}', () => {
  it('creates room via function trigger', async () => {
    const env = getTestEnv();

    const uid = `u_${Math.random().toString(16).slice(2, 10)}`;
    const roomId = `r_${Math.random().toString(16).slice(2, 10)}`;
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

describe('rooms PAKE (y) + KC security rules', () => {
  const mkUid = (p: string) => `${p}_${Math.random().toString(16).slice(2, 10)}`;
  const mkRoomId = () => `r_${Math.random().toString(16).slice(2, 10)}`;

  const MAX_LEN = 128;

  const str = (n: number, ch = 'A') => ch.repeat(n);

  const seedRoom = async (env: any, roomId: string, createdBy: string) => {
    await env.withSecurityRulesDisabled(async (ctx: any) => {
      const adminDb = ctx.database();
      await set(ref(adminDb, `/rooms/${roomId}`), {
        created_by: createdBy,
        created_at: Date.now(),
      });
    });
  };

  describe('PAKE messages (y)', () => {
    it('unauthenticated users cannot write y artifacts', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');

      await seedRoom(env, roomId, ownerUid);

      const dbUnauth = env.unauthenticatedContext().database();
      await assertFails(set(ref(dbUnauth, `/rooms/${roomId}/pake/v1/a/y`), str(43)));
      await assertFails(set(ref(dbUnauth, `/rooms/${roomId}/pake/v1/b/y`), str(43, 'B')));
    });

    it('any authenticated user can write y artifacts (not only created_by)', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');
      const uidA = mkUid('A');
      const uidB = mkUid('B');

      await seedRoom(env, roomId, ownerUid);

      const dbA = env.authenticatedContext(uidA).database();
      const dbB = env.authenticatedContext(uidB).database();

      await assertSucceeds(set(ref(dbA, `/rooms/${roomId}/pake/v1/a/y`), str(44))); // допускаем padding/вариативность
      await assertSucceeds(set(ref(dbB, `/rooms/${roomId}/pake/v1/b/y`), str(42, 'B')));
    });

    it('cannot write y artifacts if room does not exist (no "create from below")', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const uid = mkUid('u');
      const db = env.authenticatedContext(uid).database();

      await assertFails(set(ref(db, `/rooms/${roomId}/pake/v1/a/y`), str(43)));
      await assertFails(set(ref(db, `/rooms/${roomId}/pake/v1/b/y`), str(43, 'B')));
    });

    it('y must be a string and must not exceed max length', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');
      const uid = mkUid('u');

      await seedRoom(env, roomId, ownerUid);

      const db = env.authenticatedContext(uid).database();

      await assertFails(set(ref(db, `/rooms/${roomId}/pake/v1/a/y`), 123 as any));
      await assertFails(set(ref(db, `/rooms/${roomId}/pake/v1/a/y`), { x: str(10) } as any));
      await assertFails(set(ref(db, `/rooms/${roomId}/pake/v1/a/y`), null as any));

      await assertFails(set(ref(db, `/rooms/${roomId}/pake/v1/a/y`), '')); // если в rules length > 0
      await assertSucceeds(set(ref(db, `/rooms/${roomId}/pake/v1/a/y`), str(MAX_LEN)));
    });

    it('enforces max length for y (too long fails)', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');
      const uid = mkUid('u');

      await seedRoom(env, roomId, ownerUid);

      const db = env.authenticatedContext(uid).database();

      await assertFails(set(ref(db, `/rooms/${roomId}/pake/v1/a/y`), str(MAX_LEN + 1)));
    });

    it('write-once: cannot overwrite or update y after first write', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');
      const uid = mkUid('u');

      await seedRoom(env, roomId, ownerUid);

      const db = env.authenticatedContext(uid).database();

      await assertSucceeds(set(ref(db, `/rooms/${roomId}/pake/v1/a/y`), str(43)));

      // overwrite should fail
      await assertFails(set(ref(db, `/rooms/${roomId}/pake/v1/a/y`), str(44)));

      // update via parent should fail
      await assertFails(update(ref(db, `/rooms/${roomId}/pake/v1/a`), { y: str(43, 'C') }));
    });

    it('write-once: cannot delete y artifact (remove or set null)', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');
      const uid = mkUid('u');

      await seedRoom(env, roomId, ownerUid);

      const db = env.authenticatedContext(uid).database();

      await assertSucceeds(set(ref(db, `/rooms/${roomId}/pake/v1/a/y`), str(43)));

      await assertFails(remove(ref(db, `/rooms/${roomId}/pake/v1/a/y`)));
      await assertFails(set(ref(db, `/rooms/${roomId}/pake/v1/a/y`), null as any));
    });

    it('cannot write any other keys under pake/v1 besides allowed ones', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');
      const uid = mkUid('u');

      await seedRoom(env, roomId, ownerUid);

      const db = env.authenticatedContext(uid).database();

      await assertFails(set(ref(db, `/rooms/${roomId}/pake/v1/c`), str(10)));
      await assertFails(set(ref(db, `/rooms/${roomId}/pake/v2/a/y`), str(10)));

      await assertFails(set(ref(db, `/rooms/${roomId}/pake/v1/a/z`), str(10)));
      await assertFails(set(ref(db, `/rooms/${roomId}/pake/v1/b/z`), str(10)));

      // запрет записи объектом на уровень a/b (пишем только leaf y/kc)
      await assertFails(set(ref(db, `/rooms/${roomId}/pake/v1/a`), { y: str(43) } as any));
    });

    it('deleting the whole room by owner removes pake artifacts (allowed via parent delete)', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');
      const uidOther = mkUid('other');

      await seedRoom(env, roomId, ownerUid);

      const dbOther = env.authenticatedContext(uidOther).database();
      await assertSucceeds(set(ref(dbOther, `/rooms/${roomId}/pake/v1/a/y`), str(43)));
      await assertSucceeds(set(ref(dbOther, `/rooms/${roomId}/pake/v1/b/y`), str(43, 'B')));

      const dbOwner = env.authenticatedContext(ownerUid).database();
      await assertSucceeds(remove(ref(dbOwner, `/rooms/${roomId}`)));
    });
  });

  describe('Key confirmation (kc)', () => {
    it('unauthenticated users cannot write kc artifacts', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');

      await seedRoom(env, roomId, ownerUid);

      const dbUnauth = env.unauthenticatedContext().database();
      await assertFails(set(ref(dbUnauth, `/rooms/${roomId}/pake/v1/a/kc`), str(43)));
      await assertFails(set(ref(dbUnauth, `/rooms/${roomId}/pake/v1/b/kc`), str(43, 'B')));
    });

    it('kc cannot be written if room does not exist', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const uid = mkUid('u');
      const db = env.authenticatedContext(uid).database();

      await assertFails(set(ref(db, `/rooms/${roomId}/pake/v1/a/kc`), str(43)));
      await assertFails(set(ref(db, `/rooms/${roomId}/pake/v1/b/kc`), str(43, 'B')));
    });

    it('kc cannot be written before corresponding y is written (a/kc requires a/y, b/kc requires b/y)', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');
      const uid = mkUid('u');

      await seedRoom(env, roomId, ownerUid);
      const db = env.authenticatedContext(uid).database();

      // без y -> нельзя
      await assertFails(set(ref(db, `/rooms/${roomId}/pake/v1/a/kc`), str(43)));
      await assertFails(set(ref(db, `/rooms/${roomId}/pake/v1/b/kc`), str(43, 'B')));

      // записали только a/y -> a/kc можно, b/kc нельзя
      await assertSucceeds(set(ref(db, `/rooms/${roomId}/pake/v1/a/y`), str(44)));
      await assertSucceeds(set(ref(db, `/rooms/${roomId}/pake/v1/a/kc`), str(10, 'C')));
      await assertFails(set(ref(db, `/rooms/${roomId}/pake/v1/b/kc`), str(10, 'D')));

      // записали b/y -> b/kc теперь можно
      await assertSucceeds(set(ref(db, `/rooms/${roomId}/pake/v1/b/y`), str(43, 'B')));
      await assertSucceeds(set(ref(db, `/rooms/${roomId}/pake/v1/b/kc`), str(10, 'E')));
    });

    it('kc must be a string and must not exceed max length', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');
      const uid = mkUid('u');

      await seedRoom(env, roomId, ownerUid);
      const db = env.authenticatedContext(uid).database();

      // нужно иметь a/y, чтобы kc вообще был разрешён по правилу
      await assertSucceeds(set(ref(db, `/rooms/${roomId}/pake/v1/a/y`), str(43)));

      await assertFails(set(ref(db, `/rooms/${roomId}/pake/v1/a/kc`), 123 as any));
      await assertFails(set(ref(db, `/rooms/${roomId}/pake/v1/a/kc`), { x: str(10) } as any));
      await assertFails(set(ref(db, `/rooms/${roomId}/pake/v1/a/kc`), null as any));

      await assertFails(set(ref(db, `/rooms/${roomId}/pake/v1/a/kc`), '')); // если length > 0
      await assertFails(set(ref(db, `/rooms/${roomId}/pake/v1/a/kc`), str(MAX_LEN + 1)));

      await assertSucceeds(set(ref(db, `/rooms/${roomId}/pake/v1/a/kc`), str(MAX_LEN)));
    });

    it('write-once: cannot overwrite or update kc after first write', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');
      const uid = mkUid('u');

      await seedRoom(env, roomId, ownerUid);
      const db = env.authenticatedContext(uid).database();

      await assertSucceeds(set(ref(db, `/rooms/${roomId}/pake/v1/a/y`), str(43)));
      await assertSucceeds(set(ref(db, `/rooms/${roomId}/pake/v1/a/kc`), str(43, 'C')));

      await assertFails(set(ref(db, `/rooms/${roomId}/pake/v1/a/kc`), str(43, 'D')));
      await assertFails(update(ref(db, `/rooms/${roomId}/pake/v1/a`), { kc: str(10, 'E') }));
    });

    it('write-once: cannot delete kc artifact (remove or set null)', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');
      const uid = mkUid('u');

      await seedRoom(env, roomId, ownerUid);
      const db = env.authenticatedContext(uid).database();

      await assertSucceeds(set(ref(db, `/rooms/${roomId}/pake/v1/a/y`), str(43)));
      await assertSucceeds(set(ref(db, `/rooms/${roomId}/pake/v1/a/kc`), str(43, 'C')));

      await assertFails(remove(ref(db, `/rooms/${roomId}/pake/v1/a/kc`)));
      await assertFails(set(ref(db, `/rooms/${roomId}/pake/v1/a/kc`), null as any));
    });
  });
});

describe('rooms WebRTC signaling (offer/answer) security rules', () => {
  const mkUid = (p: string) => `${p}_${Math.random().toString(16).slice(2, 10)}`;
  const mkRoomId = () => `r_${Math.random().toString(16).slice(2, 10)}`;

  const MAX_LEN_WEBRTC = 32768;

  const str = (n: number, ch = 'A') => ch.repeat(n);

  const seedRoom = async (env: any, roomId: string, createdBy: string) => {
    await env.withSecurityRulesDisabled(async (ctx: any) => {
      const adminDb = ctx.database();
      await set(ref(adminDb, `/rooms/${roomId}`), {
        created_by: createdBy,
        created_at: Date.now(),
      });
    });
  };

  const seedKcs = async (env: any, roomId: string) => {
    await env.withSecurityRulesDisabled(async (ctx: any) => {
      const adminDb = ctx.database();
      // Для webrtc rules важно только существование a/kc и b/kc
      await set(ref(adminDb, `/rooms/${roomId}/pake/v1/a/kc`), str(43, 'K')); // <= 128
      await set(ref(adminDb, `/rooms/${roomId}/pake/v1/b/kc`), str(43, 'L')); // <= 128
    });
  };

  const seedOffer = async (env: any, roomId: string, offer: string) => {
    await env.withSecurityRulesDisabled(async (ctx: any) => {
      const adminDb = ctx.database();
      await set(ref(adminDb, `/rooms/${roomId}/webrtc/v1/offer`), offer);
    });
  };

  describe('offer', () => {
    it('unauthenticated users cannot write offer', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');

      await seedRoom(env, roomId, ownerUid);
      await seedKcs(env, roomId);

      const dbUnauth = env.unauthenticatedContext().database();
      await assertFails(set(ref(dbUnauth, `/rooms/${roomId}/webrtc/v1/offer`), str(10)));
    });

    it('authenticated users cannot write offer if room does not exist', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');

      const dbOwner = env.authenticatedContext(ownerUid).database();
      await assertFails(set(ref(dbOwner, `/rooms/${roomId}/webrtc/v1/offer`), str(10)));
    });

    it('owner cannot write offer before KC artifacts exist', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');

      await seedRoom(env, roomId, ownerUid);

      const dbOwner = env.authenticatedContext(ownerUid).database();
      await assertFails(set(ref(dbOwner, `/rooms/${roomId}/webrtc/v1/offer`), str(10)));
    });

    it('non-owner cannot write offer even if KC artifacts exist', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');
      const attackerUid = mkUid('attacker');

      await seedRoom(env, roomId, ownerUid);
      await seedKcs(env, roomId);

      const dbAttacker = env.authenticatedContext(attackerUid).database();
      await assertFails(set(ref(dbAttacker, `/rooms/${roomId}/webrtc/v1/offer`), str(10)));
    });

    it('owner can write offer once after KC artifacts exist', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');

      await seedRoom(env, roomId, ownerUid);
      await seedKcs(env, roomId);

      const dbOwner = env.authenticatedContext(ownerUid).database();
      await assertSucceeds(set(ref(dbOwner, `/rooms/${roomId}/webrtc/v1/offer`), str(10)));
    });

    it('offer is write-once: second write must fail', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');

      await seedRoom(env, roomId, ownerUid);
      await seedKcs(env, roomId);

      const dbOwner = env.authenticatedContext(ownerUid).database();
      await assertSucceeds(set(ref(dbOwner, `/rooms/${roomId}/webrtc/v1/offer`), str(10)));
      await assertFails(set(ref(dbOwner, `/rooms/${roomId}/webrtc/v1/offer`), str(11)));
    });

    it('offer delete must fail (writeOnce implies no delete)', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');

      await seedRoom(env, roomId, ownerUid);
      await seedKcs(env, roomId);

      const dbOwner = env.authenticatedContext(ownerUid).database();
      await assertSucceeds(set(ref(dbOwner, `/rooms/${roomId}/webrtc/v1/offer`), str(10)));
      await assertFails(set(ref(dbOwner, `/rooms/${roomId}/webrtc/v1/offer`), null));
    });

    it('offer validation: empty string must fail', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');

      await seedRoom(env, roomId, ownerUid);
      await seedKcs(env, roomId);

      const dbOwner = env.authenticatedContext(ownerUid).database();
      await assertFails(set(ref(dbOwner, `/rooms/${roomId}/webrtc/v1/offer`), ''));
    });

    it('offer validation: too long must fail, max length must succeed', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');

      await seedRoom(env, roomId, ownerUid);
      await seedKcs(env, roomId);

      const dbOwner = env.authenticatedContext(ownerUid).database();

      await assertSucceeds(
        set(ref(dbOwner, `/rooms/${roomId}/webrtc/v1/offer`), str(MAX_LEN_WEBRTC, 'O')),
      );

      // reset DB for the failing branch (write-once)
      await env.clearDatabase();
      await seedRoom(env, roomId, ownerUid);
      await seedKcs(env, roomId);

      const dbOwner2 = env.authenticatedContext(ownerUid).database();
      await assertFails(
        set(ref(dbOwner2, `/rooms/${roomId}/webrtc/v1/offer`), str(MAX_LEN_WEBRTC + 1, 'O')),
      );
    });

    it('cannot write unknown fields under webrtc/v1', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');

      await seedRoom(env, roomId, ownerUid);
      await seedKcs(env, roomId);

      const dbOwner = env.authenticatedContext(ownerUid).database();
      await assertFails(set(ref(dbOwner, `/rooms/${roomId}/webrtc/v1/evil`), str(10)));
      await assertFails(set(ref(dbOwner, `/rooms/${roomId}/webrtc/v2/offer`), str(10)));
    });
  });

  describe('answer', () => {
    it('unauthenticated users cannot write answer', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');
      const responderUid = mkUid('responder');

      await seedRoom(env, roomId, ownerUid);
      await seedKcs(env, roomId);
      await seedOffer(env, roomId, str(10, 'O'));

      const dbUnauth = env.unauthenticatedContext().database();
      await assertFails(set(ref(dbUnauth, `/rooms/${roomId}/webrtc/v1/answer`), str(10, 'A')));

      // sanity: authenticated responder is allowed in the happy-path prerequisites
      const dbResponder = env.authenticatedContext(responderUid).database();
      await assertSucceeds(
        set(ref(dbResponder, `/rooms/${roomId}/webrtc/v1/answer`), str(10, 'A')),
      );
    });

    it('owner cannot write answer', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');

      await seedRoom(env, roomId, ownerUid);
      await seedKcs(env, roomId);
      await seedOffer(env, roomId, str(10, 'O'));

      const dbOwner = env.authenticatedContext(ownerUid).database();
      await assertFails(set(ref(dbOwner, `/rooms/${roomId}/webrtc/v1/answer`), str(10, 'A')));
    });

    it('non-owner cannot write answer before offer exists', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');
      const responderUid = mkUid('responder');

      await seedRoom(env, roomId, ownerUid);
      await seedKcs(env, roomId);

      const dbResponder = env.authenticatedContext(responderUid).database();
      await assertFails(set(ref(dbResponder, `/rooms/${roomId}/webrtc/v1/answer`), str(10, 'A')));
    });

    it('non-owner cannot write answer before KC artifacts exist (even if offer exists)', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');
      const responderUid = mkUid('responder');

      await seedRoom(env, roomId, ownerUid);
      await seedOffer(env, roomId, str(10, 'O'));

      const dbResponder = env.authenticatedContext(responderUid).database();
      await assertFails(set(ref(dbResponder, `/rooms/${roomId}/webrtc/v1/answer`), str(10, 'A')));
    });

    it('non-owner can write answer once after offer + KC exist', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');
      const responderUid = mkUid('responder');

      await seedRoom(env, roomId, ownerUid);
      await seedKcs(env, roomId);
      await seedOffer(env, roomId, str(10, 'O'));

      const dbResponder = env.authenticatedContext(responderUid).database();
      await assertSucceeds(
        set(ref(dbResponder, `/rooms/${roomId}/webrtc/v1/answer`), str(10, 'A')),
      );
    });

    it('answer is write-once: second write must fail', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');
      const responderUid = mkUid('responder');

      await seedRoom(env, roomId, ownerUid);
      await seedKcs(env, roomId);
      await seedOffer(env, roomId, str(10, 'O'));

      const dbResponder = env.authenticatedContext(responderUid).database();
      await assertSucceeds(
        set(ref(dbResponder, `/rooms/${roomId}/webrtc/v1/answer`), str(10, 'A')),
      );
      await assertFails(set(ref(dbResponder, `/rooms/${roomId}/webrtc/v1/answer`), str(11, 'A')));
    });

    it('answer delete must fail (writeOnce implies no delete)', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');
      const responderUid = mkUid('responder');

      await seedRoom(env, roomId, ownerUid);
      await seedKcs(env, roomId);
      await seedOffer(env, roomId, str(10, 'O'));

      const dbResponder = env.authenticatedContext(responderUid).database();
      await assertSucceeds(
        set(ref(dbResponder, `/rooms/${roomId}/webrtc/v1/answer`), str(10, 'A')),
      );
      await assertFails(set(ref(dbResponder, `/rooms/${roomId}/webrtc/v1/answer`), null));
    });

    it('answer validation: empty string must fail', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');
      const responderUid = mkUid('responder');

      await seedRoom(env, roomId, ownerUid);
      await seedKcs(env, roomId);
      await seedOffer(env, roomId, str(10, 'O'));

      const dbResponder = env.authenticatedContext(responderUid).database();
      await assertFails(set(ref(dbResponder, `/rooms/${roomId}/webrtc/v1/answer`), ''));
    });

    it('answer validation: too long must fail, max length must succeed', async () => {
      const env = getTestEnv();
      const roomId = mkRoomId();
      const ownerUid = mkUid('owner');
      const responderUid = mkUid('responder');

      await seedRoom(env, roomId, ownerUid);
      await seedKcs(env, roomId);
      await seedOffer(env, roomId, str(10, 'O'));

      const dbResponder = env.authenticatedContext(responderUid).database();
      await assertSucceeds(
        set(ref(dbResponder, `/rooms/${roomId}/webrtc/v1/answer`), str(MAX_LEN_WEBRTC, 'A')),
      );

      // reset DB for the failing branch (write-once)
      await env.clearDatabase();
      await seedRoom(env, roomId, ownerUid);
      await seedKcs(env, roomId);
      await seedOffer(env, roomId, str(10, 'O'));

      const dbResponder2 = env.authenticatedContext(responderUid).database();
      await assertFails(
        set(ref(dbResponder2, `/rooms/${roomId}/webrtc/v1/answer`), str(MAX_LEN_WEBRTC + 1, 'A')),
      );
    });
  });
});
