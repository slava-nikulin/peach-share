import type { RulesTestContext, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { assertSucceeds } from '@firebase/rules-unit-testing';
import { type Database, get, ref, set } from 'firebase/database';
import { beforeEach, describe, expect, it } from 'vitest';
import { getTestEnv } from '../../../../tests/setup/integration-firebase';
import { RtdbRoomRepository } from '../../rtdb-room-repository';

type RulesDisabledContext = RulesTestContext;
interface RoomDoc {
  private?: {
    creator_uid?: string;
    responder_uid?: string;
    created_at?: number;
  };
  meta?: {
    state?: number;
  };
}

const mkUid = (p: string): string => `${p}_${Math.random().toString(16).slice(2, 10)}`;
const mkRoomId = (): string => `room_${Math.random().toString(16).slice(2, 18)}`;
const nowMs = (): number => Date.now();

async function adminGet(
  env: RulesTestEnvironment,
  path: string,
): Promise<{ exists: boolean; val: unknown }> {
  let exists = false;
  let val: unknown;

  await env.withSecurityRulesDisabled(async (ctx: RulesDisabledContext) => {
    const adminDb = ctx.database() as unknown as Database;
    const snap = await get(ref(adminDb, path));
    exists = snap.exists();
    val = snap.exists() ? snap.val() : undefined;
  });

  return { exists, val };
}

async function waitRoomExistsAdmin(
  env: RulesTestEnvironment,
  roomId: string,
  timeoutMs: number = 10_000,
  intervalMs: number = 100,
): Promise<RoomDoc> {
  const start = Date.now();
  let last: unknown;

  while (Date.now() - start < timeoutMs) {
    const { exists, val } = await adminGet(env, `/rooms/${roomId}`);
    last = { exists, val };
    if (exists && typeof val === 'object' && val !== null) return val as RoomDoc;
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(
    `Room not created within ${timeoutMs}ms; roomId=${roomId}; last=${JSON.stringify(last)}`,
  );
}

async function waitRoomStateAdmin(
  env: RulesTestEnvironment,
  roomId: string,
  expected: number,
  timeoutMs: number = 12_000,
  intervalMs: number = 120,
): Promise<number> {
  const start = Date.now();
  let last: unknown;

  while (Date.now() - start < timeoutMs) {
    const { exists, val } = await adminGet(env, `/rooms/${roomId}/meta/state`);
    last = { exists, val };
    const n = Number(val);
    if (exists && Number.isFinite(n) && n === expected) return n;
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(
    `meta/state did not reach ==${expected} within ${timeoutMs}ms; roomId=${roomId}; last=${JSON.stringify(last)}`,
  );
}

async function waitRoomDeletedAdmin(
  env: RulesTestEnvironment,
  roomId: string,
  timeoutMs: number = 20_000,
  intervalMs: number = 150,
): Promise<void> {
  const start = Date.now();
  let last: unknown;

  while (Date.now() - start < timeoutMs) {
    const { exists, val } = await adminGet(env, `/rooms/${roomId}`);
    last = { exists, val };
    if (!exists) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(
    `Room was not deleted within ${timeoutMs}ms; roomId=${roomId}; last=${JSON.stringify(last)}`,
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

describe('Cloud Functions integration: registerCreator/registerResponder/deleteRoomOnDeletionRequested', () => {
  let env: RulesTestEnvironment;

  beforeEach(async () => {
    env = getTestEnv();
    await env.clearDatabase();
  });

  it('registerCreator: user slot /{uid}/create creates /rooms/{roomId} with creator_uid and state=1', async () => {
    const creatorUid = mkUid('creator');
    const roomId = mkRoomId();

    const creatorDb = env.authenticatedContext(creatorUid).database() as unknown as Database;

    await assertSucceeds(
      set(ref(creatorDb, `/${creatorUid}/create`), {
        room_id: roomId,
        created_at: nowMs(),
      }),
    );

    await waitRoomStateAdmin(env, roomId, 1);

    const room = await waitRoomExistsAdmin(env, roomId);
    expect(room).toBeTruthy();

    expect(room?.private?.creator_uid).toBe(creatorUid);
    expect(room?.private?.responder_uid).toBeUndefined();
    expect(typeof room?.private?.created_at).toBe('number');

    expect(room?.meta?.state).toBe(1);
  });

  it('registerCreator: invalid slot (admin write) should be ignored (no room created)', async () => {
    const uid = mkUid('u');
    const roomId = mkRoomId();

    // Пишем в слот с отключенными rules, чтобы проверить именно parseSlot() в функции.
    await env.withSecurityRulesDisabled(async (ctx: RulesDisabledContext) => {
      const adminDb = ctx.database() as unknown as Database;
      await set(ref(adminDb, `/${uid}/create`), { room_id: '', created_at: nowMs() }); // invalid
    });

    // Даем функции шанс отработать
    await sleep(500);

    const { exists } = await adminGet(env, `/rooms/${roomId}`);
    expect(exists).toBe(false);
  });

  it('registerCreator: first creator wins (second creator cannot overwrite creator_uid)', async () => {
    const creator1 = mkUid('c1');
    const creator2 = mkUid('c2');
    const roomId = mkRoomId();

    const db1 = env.authenticatedContext(creator1).database() as unknown as Database;
    const db2 = env.authenticatedContext(creator2).database() as unknown as Database;

    await assertSucceeds(
      set(ref(db1, `/${creator1}/create`), { room_id: roomId, created_at: nowMs() }),
    );
    await waitRoomStateAdmin(env, roomId, 1);

    await assertSucceeds(
      set(ref(db2, `/${creator2}/create`), { room_id: roomId, created_at: nowMs() }),
    );
    await sleep(800);

    const room = await waitRoomExistsAdmin(env, roomId);
    expect(room?.private?.creator_uid).toBe(creator1);
    expect(room?.private?.responder_uid).toBeUndefined();
    expect(room?.meta?.state).toBe(1);
  });

  it('registerCreator: idempotent (writing create again by same creator must not drop responder/state)', async () => {
    const creator = mkUid('creator');
    const responder = mkUid('responder');
    const roomId = mkRoomId();

    const creatorDb = env.authenticatedContext(creator).database() as unknown as Database;

    // 1) create room via slot
    await assertSucceeds(
      set(ref(creatorDb, `/${creator}/create`), { room_id: roomId, created_at: nowMs() }),
    );
    await waitRoomStateAdmin(env, roomId, 1);

    // 2) emulate that responder already joined (admin)
    await env.withSecurityRulesDisabled(async (ctx: RulesDisabledContext) => {
      const adminDb = ctx.database() as unknown as Database;
      await set(ref(adminDb, `/rooms/${roomId}/private/responder_uid`), responder);
      await set(ref(adminDb, `/rooms/${roomId}/meta/state`), 2);
    });

    // 3) To trigger registerCreator again without waiting 10s cooldown:
    // seed an "old slot" as admin so authenticated overwrite is allowed by rules.
    await env.withSecurityRulesDisabled(async (ctx: RulesDisabledContext) => {
      const adminDb = ctx.database() as unknown as Database;
      await set(ref(adminDb, `/${creator}/create`), {
        room_id: roomId,
        created_at: nowMs() - 11_000,
      });
    });

    // overwrite as client => triggers function
    await assertSucceeds(
      set(ref(creatorDb, `/${creator}/create`), { room_id: roomId, created_at: nowMs() }),
    );
    await sleep(900);

    const room = await waitRoomExistsAdmin(env, roomId);
    expect(room?.private?.creator_uid).toBe(creator);
    expect(room?.private?.responder_uid).toBe(responder);
    expect(room?.meta?.state).toBe(2);
  });

  it('registerResponder: valid /{uid}/join assigns responder_uid and sets state=2', async () => {
    const creator = mkUid('creator');
    const responder = mkUid('responder');
    const roomId = mkRoomId();

    const creatorDb = env.authenticatedContext(creator).database() as unknown as Database;
    const responderDb = env.authenticatedContext(responder).database() as unknown as Database;

    await assertSucceeds(
      set(ref(creatorDb, `/${creator}/create`), { room_id: roomId, created_at: nowMs() }),
    );
    await waitRoomStateAdmin(env, roomId, 1);

    await assertSucceeds(
      set(ref(responderDb, `/${responder}/join`), { room_id: roomId, created_at: nowMs() }),
    );
    await waitRoomStateAdmin(env, roomId, 2);

    const room = await waitRoomExistsAdmin(env, roomId);
    expect(room?.private?.creator_uid).toBe(creator);
    expect(room?.private?.responder_uid).toBe(responder);
    expect(room?.meta?.state).toBe(2);
  });

  it('registerResponder: creator cannot join as responder (responder_uid stays empty, state stays 1)', async () => {
    const creator = mkUid('creator');
    const roomId = mkRoomId();

    const creatorDb = env.authenticatedContext(creator).database() as unknown as Database;

    await assertSucceeds(
      set(ref(creatorDb, `/${creator}/create`), { room_id: roomId, created_at: nowMs() }),
    );
    await waitRoomStateAdmin(env, roomId, 1);

    await assertSucceeds(
      set(ref(creatorDb, `/${creator}/join`), { room_id: roomId, created_at: nowMs() }),
    );
    await sleep(900);

    const room = await waitRoomExistsAdmin(env, roomId);
    expect(room?.private?.responder_uid).toBeUndefined();
    expect(room?.meta?.state).toBe(1);
  });

  it('registerResponder: first responder wins (second responder cannot replace responder_uid)', async () => {
    const creator = mkUid('creator');
    const r1 = mkUid('r1');
    const r2 = mkUid('r2');
    const roomId = mkRoomId();

    const creatorDb = env.authenticatedContext(creator).database() as unknown as Database;
    const db1 = env.authenticatedContext(r1).database() as unknown as Database;
    const db2 = env.authenticatedContext(r2).database() as unknown as Database;

    await assertSucceeds(
      set(ref(creatorDb, `/${creator}/create`), { room_id: roomId, created_at: nowMs() }),
    );
    await waitRoomStateAdmin(env, roomId, 1);

    await assertSucceeds(set(ref(db1, `/${r1}/join`), { room_id: roomId, created_at: nowMs() }));
    await waitRoomStateAdmin(env, roomId, 2);

    await assertSucceeds(set(ref(db2, `/${r2}/join`), { room_id: roomId, created_at: nowMs() }));
    await sleep(900);

    const room = await waitRoomExistsAdmin(env, roomId);
    expect(room?.private?.responder_uid).toBe(r1);
    expect(room?.meta?.state).toBe(2);
  });

  it('registerResponder: join before room exists does not create room and is not retried automatically', async () => {
    const creator = mkUid('creator');
    const responder = mkUid('responder');
    const roomId = mkRoomId();

    const creatorDb = env.authenticatedContext(creator).database() as unknown as Database;
    const responderDb = env.authenticatedContext(responder).database() as unknown as Database;

    // responder writes join first (room absent)
    await assertSucceeds(
      set(ref(responderDb, `/${responder}/join`), { room_id: roomId, created_at: nowMs() }),
    );
    await sleep(900);

    // still no room
    const pre = await adminGet(env, `/rooms/${roomId}`);
    expect(pre.exists).toBe(false);

    // now creator creates
    await assertSucceeds(
      set(ref(creatorDb, `/${creator}/create`), { room_id: roomId, created_at: nowMs() }),
    );
    await waitRoomStateAdmin(env, roomId, 1);

    // responder_uid remains empty because registerResponder already fired earlier and won't re-fire without a new write
    const room = await waitRoomExistsAdmin(env, roomId);
    expect(room?.private?.creator_uid).toBe(creator);
    expect(room?.private?.responder_uid).toBeUndefined();
    expect(room?.meta?.state).toBe(1);
  });

  it('deleteRoomOnDeletionRequested: when participant sets meta/deleteRequested (rules satisfied), room is removed', async () => {
    const creator = mkUid('creator');
    const responder = mkUid('responder');
    const roomId = mkRoomId();

    const creatorDb = env.authenticatedContext(creator).database() as unknown as Database;
    const responderDb = env.authenticatedContext(responder).database() as unknown as Database;

    // 1) create and join (so private.{creator,responder} set by functions)
    await assertSucceeds(
      set(ref(creatorDb, `/${creator}/create`), { room_id: roomId, created_at: nowMs() }),
    );
    await waitRoomStateAdmin(env, roomId, 1);

    await assertSucceeds(
      set(ref(responderDb, `/${responder}/join`), { room_id: roomId, created_at: nowMs() }),
    );
    await waitRoomStateAdmin(env, roomId, 2);

    // 2) seed required messages as admin (чтобы правила разрешили deleteRequested)
    await env.withSecurityRulesDisabled(async (ctx: RulesDisabledContext) => {
      const adminDb = ctx.database() as unknown as Database;
      await set(ref(adminDb, `/rooms/${roomId}/messages`), {
        creator: { pake: { msg: 'a', mac_tag: 'b' }, rtc: { msg: 'c' } },
        responder: { pake: { msg: 'd', mac_tag: 'e' }, rtc: { msg: 'f' } },
      });
    });

    // 3) participant writes deleteRequested once (rules allow)
    await assertSucceeds(set(ref(creatorDb, `/rooms/${roomId}/meta/deleteRequested`), true));

    // 4) function should delete room
    await waitRoomDeletedAdmin(env, roomId, 25_000);
  });

  it('finalize() does not suppress deletion request when meta/state is unexpected', async () => {
    const creator = mkUid('creator');
    const responder = mkUid('responder');
    const roomId = mkRoomId();

    const creatorDb = env.authenticatedContext(creator).database() as unknown as Database;
    const responderDb = env.authenticatedContext(responder).database() as unknown as Database;

    await assertSucceeds(
      set(ref(creatorDb, `/${creator}/create`), { room_id: roomId, created_at: nowMs() }),
    );
    await waitRoomStateAdmin(env, roomId, 1);

    await assertSucceeds(
      set(ref(responderDb, `/${responder}/join`), { room_id: roomId, created_at: nowMs() }),
    );
    await waitRoomStateAdmin(env, roomId, 2);

    await env.withSecurityRulesDisabled(async (ctx: RulesDisabledContext) => {
      const adminDb = ctx.database() as unknown as Database;
      await set(ref(adminDb, `/rooms/${roomId}/messages`), {
        creator: { pake: { msg: 'a', mac_tag: 'b' }, rtc: { msg: 'c' } },
        responder: { pake: { msg: 'd', mac_tag: 'e' }, rtc: { msg: 'f' } },
      });
      await set(ref(adminDb, `/rooms/${roomId}/meta/state`), 99);
    });

    const repo = new RtdbRoomRepository(creatorDb);
    await repo.finalize(roomId);

    await waitRoomDeletedAdmin(env, roomId, 25_000);
  });
});
