/** biome-ignore-all lint/nursery/noUnresolvedImports: test file */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RulesTestContext, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { type Database, get, ref, remove, set, setWithPriority } from 'firebase/database';
import { beforeEach, describe, expect, it } from 'vitest';
import { getTestEnv } from '../../../../tests/setup/integration-firebase';

type RulesDisabledContext = RulesTestContext;
type RulesDisabledEnv = RulesTestEnvironment;

const mkUid = (p: string): string => `${p}_${Math.random().toString(16).slice(2, 10)}`;
const mkRoomId = (): string => `room_${Math.random().toString(16).slice(2, 18)}`;

/**
 * Важно: rules опираются на now. Чтобы тесты не флапали, используем безопасные зазоры:
 * - "моложе 10 сек" => created_at = now - 9000 (должно FAIL)
 * - "старше 10 сек" => created_at = now - 11000 (должно SUCCEED)
 * - "слишком старый для validate" => now - 3000 (FAIL, т.к. окно ±2000)
 * - "слишком будущий" => now + 3000 (FAIL)
 */
const nowMs = (): number => Date.now();

async function createIsolatedRulesEnv(projectId: string): Promise<RulesTestEnvironment> {
  const rulesPath = resolve(process.cwd(), 'docker/config/firebase/database.rules.json');
  const rules = readFileSync(rulesPath, 'utf8');

  return await initializeTestEnvironment({
    projectId,
    database: {
      host: '127.0.0.1',
      port: 9000,
      rules,
    },
  });
}

async function adminSet(env: RulesDisabledEnv, path: string, value: unknown): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx: RulesDisabledContext) => {
    const adminDb = ctx.database() as unknown as Database;
    await set(ref(adminDb, path), value);
  });
}

async function adminGet(env: RulesDisabledEnv, path: string): Promise<unknown> {
  let out: unknown;
  await env.withSecurityRulesDisabled(async (ctx: RulesDisabledContext) => {
    const adminDb = ctx.database() as unknown as Database;
    const snap = await get(ref(adminDb, path));
    out = snap.exists() ? snap.val() : undefined;
  });
  return out;
}

/**
 * Минимальный валидный room doc для messages/state тестов.
 * Приватку клиенты не пишут; мы её сидим админом.
 */
async function seedRoomBase(
  env: RulesDisabledEnv,
  roomId: string,
  creatorUid: string,
): Promise<void> {
  await adminSet(env, `/rooms/${roomId}`, {
    private: {
      creator_uid: creatorUid,
      responder_uid: null,
      created_at: nowMs(),
    },
    meta: { state: 1 },
  });
}

async function seedResponderJoined(
  env: RulesDisabledEnv,
  roomId: string,
  responderUid: string,
): Promise<void> {
  const cur = (await adminGet(env, `/rooms/${roomId}`)) as Record<string, unknown> | undefined;
  const curPrivate =
    cur && typeof cur.private === 'object' && cur.private !== null
      ? (cur.private as Record<string, unknown>)
      : undefined;
  const curMeta =
    cur && typeof cur.meta === 'object' && cur.meta !== null
      ? (cur.meta as Record<string, unknown>)
      : undefined;
  const next = {
    ...(cur ?? {}),
    private: {
      ...(curPrivate ?? {}),
      responder_uid: responderUid,
    },
    meta: {
      ...(curMeta ?? {}),
      state: 2,
    },
  };
  await adminSet(env, `/rooms/${roomId}`, next);
}

async function seedAllMessagesPresent(env: RulesDisabledEnv, roomId: string): Promise<void> {
  // Все 6 обязательных сообщений должны существовать, иначе deleteRequested запрещён rules.
  await adminSet(env, `/rooms/${roomId}/messages`, {
    creator: {
      pake: { msg: 'a', mac_tag: 'b' },
      rtc: { msg: 'c' },
    },
    responder: {
      pake: { msg: 'd', mac_tag: 'e' },
      rtc: { msg: 'f' },
    },
  });
}

describe('RTDB security rules: user slots /{uid}/{create|join}', () => {
  let env: RulesDisabledEnv;

  beforeEach(async () => {
    env = getTestEnv();
    await env.clearDatabase();
  });

  it('unauth: cannot write to /{uid}/create', async () => {
    const uid = mkUid('u');
    const db = env.unauthenticatedContext().database() as unknown as Database;

    await assertFails(
      set(ref(db, `/${uid}/create`), {
        room_id: 'x',
        created_at: nowMs(),
      }),
    );
  });

  it('auth: can create own slot (create) with valid payload', async () => {
    const uid = mkUid('u');
    const db = env.authenticatedContext(uid).database() as unknown as Database;

    await assertSucceeds(
      set(ref(db, `/${uid}/create`), {
        room_id: 'room-1',
        created_at: nowMs(),
      }),
    );
  });

  it('auth: cannot write to /{otherUid}/create', async () => {
    const uid = mkUid('u');
    const other = mkUid('other');
    const db = env.authenticatedContext(uid).database() as unknown as Database;

    await assertFails(
      set(ref(db, `/${other}/create`), {
        room_id: 'room-1',
        created_at: nowMs(),
      }),
    );
  });

  it('auth: cannot write to /{uid}/<action> when action is not create/join', async () => {
    const uid = mkUid('u');
    const db = env.authenticatedContext(uid).database() as unknown as Database;

    await assertFails(
      set(ref(db, `/${uid}/hack`), {
        room_id: 'room-1',
        created_at: nowMs(),
      }),
    );
  });

  it('validate: missing room_id/created_at or extra fields are rejected', async () => {
    const uid = mkUid('u');
    const db = env.authenticatedContext(uid).database() as unknown as Database;

    await assertFails(set(ref(db, `/${uid}/create`), { room_id: 'x' }));
    await assertFails(set(ref(db, `/${uid}/create`), { created_at: nowMs() }));

    await assertFails(
      set(ref(db, `/${uid}/create`), {
        room_id: 'x',
        created_at: nowMs(),
        extra: 123,
      }),
    );
  });

  it('validate: room_id must be 1..128 string', async () => {
    const uid = mkUid('u');
    const db = env.authenticatedContext(uid).database() as unknown as Database;

    await assertFails(set(ref(db, `/${uid}/create`), { room_id: '', created_at: nowMs() }));
    await assertFails(
      set(ref(db, `/${uid}/create`), { room_id: 'x'.repeat(129), created_at: nowMs() }),
    );
    await assertFails(set(ref(db, `/${uid}/create`), { room_id: 123, created_at: nowMs() }));
  });

  it('validate: created_at must be within now ±2000ms', async () => {
    const uid = mkUid('u');
    const db = env.authenticatedContext(uid).database() as unknown as Database;

    await assertFails(set(ref(db, `/${uid}/create`), { room_id: 'x', created_at: nowMs() - 3000 }));
    await assertFails(set(ref(db, `/${uid}/create`), { room_id: 'x', created_at: nowMs() + 3000 }));

    await assertSucceeds(set(ref(db, `/${uid}/create`), { room_id: 'x', created_at: nowMs() }));
  });

  it('cooldown: cannot overwrite slot within 10s; can overwrite after 10s', async () => {
    const uid = mkUid('u');
    const db = env.authenticatedContext(uid).database() as unknown as Database;

    // initial create
    await assertSucceeds(set(ref(db, `/${uid}/create`), { room_id: 'a', created_at: nowMs() }));

    // overwrite too soon (data.created_at is "fresh" => should FAIL)
    await assertFails(set(ref(db, `/${uid}/create`), { room_id: 'b', created_at: nowMs() }));

    // seed "old enough" entry as admin, then overwrite should SUCCEED
    await adminSet(env, `/${uid}/create`, { room_id: 'old', created_at: nowMs() - 11_000 });

    await assertSucceeds(set(ref(db, `/${uid}/create`), { room_id: 'new', created_at: nowMs() }));
  });

  it('cooldown: cannot delete slot within 10s; can delete after 10s', async () => {
    const uid = mkUid('u');
    const db = env.authenticatedContext(uid).database() as unknown as Database;

    await assertSucceeds(set(ref(db, `/${uid}/join`), { room_id: 'a', created_at: nowMs() }));

    await assertFails(remove(ref(db, `/${uid}/join`)));

    await adminSet(env, `/${uid}/join`, { room_id: 'old', created_at: nowMs() - 11_000 });
    await assertSucceeds(remove(ref(db, `/${uid}/join`)));
  });

  it('validate: on overwrite created_at must be strictly increasing', async () => {
    const uid = mkUid('u');
    const db = env.authenticatedContext(uid).database() as unknown as Database;

    // seed old enough slot
    const t0 = nowMs() - 11_000;
    await adminSet(env, `/${uid}/create`, { room_id: 'old', created_at: t0 });

    // created_at not increasing => FAIL (even though cooldown ok)
    await assertFails(set(ref(db, `/${uid}/create`), { room_id: 'x', created_at: t0 }));

    // increasing => SUCCEED
    await assertSucceeds(set(ref(db, `/${uid}/create`), { room_id: 'x', created_at: nowMs() }));
  });

  it('validate: priority must be null (setWithPriority should fail)', async () => {
    const uid = mkUid('u');
    const db = env.authenticatedContext(uid).database() as unknown as Database;

    await assertFails(
      setWithPriority(
        ref(db, `/${uid}/create`),
        { room_id: 'x', created_at: nowMs() },
        123, // priority
      ),
    );
  });

  it('read model: can read /{uid}, and parent read also allows /{uid}/create', async () => {
    const uid = mkUid('u');
    const db = env.authenticatedContext(uid).database() as unknown as Database;

    await assertSucceeds(set(ref(db, `/${uid}/create`), { room_id: 'x', created_at: nowMs() }));

    // parent node read allowed by rules
    await assertSucceeds(get(ref(db, `/${uid}`)));

    // In RTDB, parent ".read" grants descendant reads; child ".read=false" cannot revoke it.
    await assertSucceeds(get(ref(db, `/${uid}/create`)));
  });
});

describe('RTDB security rules: /rooms/{roomId} messages and deletion request', () => {
  let env: RulesDisabledEnv;

  beforeEach(async () => {
    env = getTestEnv();
    await env.clearDatabase();
  });

  it('messages read: unauth cannot read rooms/meta', async () => {
    const roomId = mkRoomId();
    const creator = mkUid('creator');
    await seedRoomBase(env, roomId, creator);

    const db = env.unauthenticatedContext().database() as unknown as Database;
    await assertFails(get(ref(db, `/rooms/${roomId}/meta/state`)));
  });

  it('meta read: any auth can read /rooms/{roomId}/meta/state', async () => {
    const roomId = mkRoomId();
    const creator = mkUid('creator');
    await seedRoomBase(env, roomId, creator);

    const randomUser = mkUid('random');
    const db = env.authenticatedContext(randomUser).database() as unknown as Database;

    const snap = await assertSucceeds(get(ref(db, `/rooms/${roomId}/meta/state`)));
    expect(snap.exists()).toBe(true);
    expect(Number(snap.val())).toBe(1);
  });

  it('creator: can write creator/pake/msg only once and only when state>=1 exists', async () => {
    const roomId = mkRoomId();
    const creator = mkUid('creator');
    await seedRoomBase(env, roomId, creator);

    const creatorDb = env.authenticatedContext(creator).database() as unknown as Database;

    // ok
    await assertSucceeds(set(ref(creatorDb, `/rooms/${roomId}/messages/creator/pake/msg`), 'A'));

    // second write denied (data.exists())
    await assertFails(set(ref(creatorDb, `/rooms/${roomId}/messages/creator/pake/msg`), 'B'));

    // invalid length > 64 denied (fresh path)
    const roomId2 = mkRoomId();
    await seedRoomBase(env, roomId2, creator);
    await assertFails(
      set(ref(creatorDb, `/rooms/${roomId2}/messages/creator/pake/msg`), 'x'.repeat(65)),
    );
  });

  it('creator: cannot write creator/pake/msg when meta/state missing', async () => {
    const roomId = mkRoomId();
    const creator = mkUid('creator');

    // seed without meta/state
    await adminSet(env, `/rooms/${roomId}`, {
      private: { creator_uid: creator, responder_uid: null, created_at: nowMs() },
      // meta missing
    });

    const creatorDb = env.authenticatedContext(creator).database() as unknown as Database;
    await assertFails(set(ref(creatorDb, `/rooms/${roomId}/messages/creator/pake/msg`), 'A'));
  });

  it('role separation: non-creator cannot write creator branch', async () => {
    const roomId = mkRoomId();
    const creator = mkUid('creator');
    const other = mkUid('other');
    await seedRoomBase(env, roomId, creator);

    const otherDb = env.authenticatedContext(other).database() as unknown as Database;
    await assertFails(set(ref(otherDb, `/rooms/${roomId}/messages/creator/pake/msg`), 'A'));
  });

  it('creator: mac_tag requires creator msg; rtc requires mac_tag', async () => {
    const roomId = mkRoomId();
    const creator = mkUid('creator');
    await seedRoomBase(env, roomId, creator);

    const db = env.authenticatedContext(creator).database() as unknown as Database;

    // mac_tag before msg => denied
    await assertFails(set(ref(db, `/rooms/${roomId}/messages/creator/pake/mac_tag`), 'T'));

    // write msg then mac_tag ok
    await assertSucceeds(set(ref(db, `/rooms/${roomId}/messages/creator/pake/msg`), 'A'));
    await assertSucceeds(set(ref(db, `/rooms/${roomId}/messages/creator/pake/mac_tag`), 'T'));

    // rtc before mac_tag (fresh room) denied
    const roomId2 = mkRoomId();
    await seedRoomBase(env, roomId2, creator);
    const db2 = env.authenticatedContext(creator).database() as unknown as Database;
    await assertSucceeds(set(ref(db2, `/rooms/${roomId2}/messages/creator/pake/msg`), 'A'));
    await assertFails(set(ref(db2, `/rooms/${roomId2}/messages/creator/rtc/msg`), 'OFFER'));

    // rtc after mac_tag ok
    await assertSucceeds(set(ref(db2, `/rooms/${roomId2}/messages/creator/pake/mac_tag`), 'T'));
    await assertSucceeds(set(ref(db2, `/rooms/${roomId2}/messages/creator/rtc/msg`), 'OFFER'));
  });

  it('responder: cannot write responder msg when state<2 or responder_uid is null', async () => {
    const roomId = mkRoomId();
    const creator = mkUid('creator');
    const responder = mkUid('responder');
    await seedRoomBase(env, roomId, creator); // state=1, responder_uid=null

    const responderDb = env.authenticatedContext(responder).database() as unknown as Database;
    await assertFails(set(ref(responderDb, `/rooms/${roomId}/messages/responder/pake/msg`), 'B'));

    // even if state=2, but responder_uid still null => should still fail (auth.uid check)
    await adminSet(env, `/rooms/${roomId}/meta/state`, 2);
    await assertFails(set(ref(responderDb, `/rooms/${roomId}/messages/responder/pake/msg`), 'B'));
  });

  it('responder: can write responder branch only when joined (responder_uid) and state>=2; ordering enforced', async () => {
    const roomId = mkRoomId();
    const creator = mkUid('creator');
    const responder = mkUid('responder');
    await seedRoomBase(env, roomId, creator);
    await seedResponderJoined(env, roomId, responder); // state=2, responder_uid set

    const db = env.authenticatedContext(responder).database() as unknown as Database;

    // msg ok
    await assertSucceeds(set(ref(db, `/rooms/${roomId}/messages/responder/pake/msg`), 'B'));

    // mac_tag ok only after msg
    await assertSucceeds(set(ref(db, `/rooms/${roomId}/messages/responder/pake/mac_tag`), 'TB'));

    // rtc ok only after mac_tag
    await assertSucceeds(set(ref(db, `/rooms/${roomId}/messages/responder/rtc/msg`), 'ANSWER'));

    // cannot overwrite
    await assertFails(set(ref(db, `/rooms/${roomId}/messages/responder/pake/msg`), 'B2'));
  });

  it('messages read: only participants can read messages', async () => {
    const roomId = mkRoomId();
    const creator = mkUid('creator');
    const responder = mkUid('responder');
    const outsider = mkUid('outsider');

    await seedRoomBase(env, roomId, creator);
    await seedResponderJoined(env, roomId, responder);
    await seedAllMessagesPresent(env, roomId);

    const creatorDb = env.authenticatedContext(creator).database() as unknown as Database;
    const responderDb = env.authenticatedContext(responder).database() as unknown as Database;
    const outsiderDb = env.authenticatedContext(outsider).database() as unknown as Database;

    await assertSucceeds(get(ref(creatorDb, `/rooms/${roomId}/messages`)));
    await assertSucceeds(get(ref(responderDb, `/rooms/${roomId}/messages`)));
    await assertFails(get(ref(outsiderDb, `/rooms/${roomId}/messages`)));
  });

  it('meta/state write: clients cannot set 1, 2 or 3', async () => {
    const roomId = mkRoomId();
    const creator = mkUid('creator');
    await seedRoomBase(env, roomId, creator);

    const db = env.authenticatedContext(creator).database() as unknown as Database;

    await assertFails(set(ref(db, `/rooms/${roomId}/meta/state`), 1));
    await assertFails(set(ref(db, `/rooms/${roomId}/meta/state`), 2));
    await assertFails(set(ref(db, `/rooms/${roomId}/meta/state`), 3));
  });

  it('meta/deleteRequested: cannot set until all required messages exist', async () => {
    const roomId = mkRoomId();
    const creator = mkUid('creator');
    const responder = mkUid('responder');
    await seedRoomBase(env, roomId, creator);
    await seedResponderJoined(env, roomId, responder);

    const creatorDb = env.authenticatedContext(creator).database() as unknown as Database;

    // no messages yet => deny
    await assertFails(set(ref(creatorDb, `/rooms/${roomId}/meta/deleteRequested`), true));

    // partial messages => still deny
    await adminSet(env, `/rooms/${roomId}/messages/creator/pake/msg`, 'a');
    await adminSet(env, `/rooms/${roomId}/messages/creator/pake/mac_tag`, 'b');
    await adminSet(env, `/rooms/${roomId}/messages/creator/rtc/msg`, 'c');
    await assertFails(set(ref(creatorDb, `/rooms/${roomId}/meta/deleteRequested`), true));
  });

  it('meta/deleteRequested: participant can set when all messages exist; outsider cannot', async () => {
    const roomId = mkRoomId();
    const creator = mkUid('creator');
    const responder = mkUid('responder');
    const outsider = mkUid('outsider');

    await seedRoomBase(env, roomId, creator);
    await seedResponderJoined(env, roomId, responder);
    await seedAllMessagesPresent(env, roomId);

    const creatorDb = env.authenticatedContext(creator).database() as unknown as Database;
    const outsiderDb = env.authenticatedContext(outsider).database() as unknown as Database;

    await assertFails(set(ref(outsiderDb, `/rooms/${roomId}/meta/deleteRequested`), true));
    await assertSucceeds(set(ref(creatorDb, `/rooms/${roomId}/meta/deleteRequested`), true));
  });

  it('meta/deleteRequested: responder can also request deletion first', async () => {
    const roomId = mkRoomId();
    const creator = mkUid('creator');
    const responder = mkUid('responder');

    await seedRoomBase(env, roomId, creator);
    await seedResponderJoined(env, roomId, responder);
    await seedAllMessagesPresent(env, roomId);

    const responderDb = env.authenticatedContext(responder).database() as unknown as Database;
    await assertSucceeds(set(ref(responderDb, `/rooms/${roomId}/meta/deleteRequested`), true));
  });
});

describe('RTDB security rules: deleteRequested create-once semantics (isolated namespace)', () => {
  it('enforces one-shot writes without relying on function deletion timing', async () => {
    const isolatedEnv = await createIsolatedRulesEnv(
      `demo-peach-share-rules-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    );

    try {
      await isolatedEnv.clearDatabase();

      const roomId = mkRoomId();
      const creator = mkUid('creator');
      const responder = mkUid('responder');

      await seedRoomBase(isolatedEnv, roomId, creator);
      await seedResponderJoined(isolatedEnv, roomId, responder);
      await seedAllMessagesPresent(isolatedEnv, roomId);

      const creatorDb = isolatedEnv.authenticatedContext(creator).database() as unknown as Database;
      const responderDb = isolatedEnv
        .authenticatedContext(responder)
        .database() as unknown as Database;

      await assertSucceeds(set(ref(creatorDb, `/rooms/${roomId}/meta/deleteRequested`), true));

      expect(await adminGet(isolatedEnv, `/rooms/${roomId}/meta/deleteRequested`)).toBe(true);
      expect(await adminGet(isolatedEnv, `/rooms/${roomId}`)).toBeTruthy();

      await assertFails(set(ref(creatorDb, `/rooms/${roomId}/meta/deleteRequested`), true));
      await assertFails(set(ref(responderDb, `/rooms/${roomId}/meta/deleteRequested`), true));
    } finally {
      await isolatedEnv.cleanup();
    }
  });
});
