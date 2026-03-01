// biome-ignore lint/nursery/noUnresolvedImports: test file
import http from 'node:http';
import type { RulesTestContext, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { type Database, get, ref, set } from 'firebase/database';
import { beforeEach, describe, expect, it } from 'vitest';
import { getTestEnv } from '../../../../tests/setup/integration-firebase';

type RulesDisabledContext = RulesTestContext;
type JsonObject = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null;

const nowMs = (): number => Date.now();
const mkUid = (p: string): string => `${p}_${Math.random().toString(16).slice(2, 10)}`;
const mkRoomId = (): string => `room_${Math.random().toString(16).slice(2, 18)}`;

async function adminSet(env: RulesTestEnvironment, path: string, value: unknown): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx: RulesDisabledContext) => {
    const adminDb = ctx.database() as unknown as Database;
    await set(ref(adminDb, path), value);
  });
}

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

async function httpGetJson<T>(url: string): Promise<T> {
  await new Promise<void>((r) => setTimeout(r, 0));

  return await new Promise<T>((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data) as T);
        } catch (e) {
          reject(new Error(`Failed to parse JSON from ${url}: ${String(e)}; body=${data}`));
        }
      });
    });
    req.on('error', reject);
  });
}

async function ensureAdminRtdbEmulatorEnv(env: RulesTestEnvironment): Promise<void> {
  const envProjectId = Reflect.get(env as object, 'projectId');
  const projectId: string =
    typeof envProjectId === 'string' && envProjectId.length > 0
      ? envProjectId
      : (process.env.GCLOUD_PROJECT ?? 'demo-project');
  process.env.GCLOUD_PROJECT = String(projectId);

  const setDatabaseUrl = (host: string): void => {
    process.env.FIREBASE_DATABASE_URL = `http://${host}?ns=${projectId}`;
  };

  if (process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
    setDatabaseUrl(process.env.FIREBASE_DATABASE_EMULATOR_HOST);
    return;
  }

  // Пытаемся узнать порт RTDB через Emulator Hub (самый надёжный способ)
  const hub = process.env.FIREBASE_EMULATOR_HUB ?? '127.0.0.1:4400';
  try {
    const emulators = await httpGetJson<{ database?: { port?: unknown } }>(
      `http://${hub}/emulators`,
    );
    const dbPort = emulators.database?.port;
    if (typeof dbPort === 'number' && dbPort > 0) {
      process.env.FIREBASE_DATABASE_EMULATOR_HOST = `127.0.0.1:${dbPort}`;
      setDatabaseUrl(process.env.FIREBASE_DATABASE_EMULATOR_HOST);
      return;
    }
  } catch {}

  // Fallback на дефолтный порт RTDB emulator
  process.env.FIREBASE_DATABASE_EMULATOR_HOST = '127.0.0.1:9000';
  setDatabaseUrl(process.env.FIREBASE_DATABASE_EMULATOR_HOST);
}

describe('janitor integration', () => {
  let env: RulesTestEnvironment;
  let runJanitorOnce: (opts?: { maxAgeMs?: number }) => Promise<{
    cutoff: number;
    roomsDeleted: number;
    slotsDeleted: number;
    usersDeleted: number;
  }>;

  beforeEach(async () => {
    env = getTestEnv();
    await env.clearDatabase();

    await ensureAdminRtdbEmulatorEnv(env);

    if (!runJanitorOnce) {
      // Важно: импортировать ПОСЛЕ установки env vars, чтобы admin SDK точно подключился к emulator
      const functionsModulePath = '../../../../../functions/src/index';
      const mod = await import(functionsModulePath);
      runJanitorOnce = mod.runJanitorOnce as typeof runJanitorOnce;
    }
  });

  it('removes rooms older than 1h and cleans userspace old slots; deletes uid node if empty after cleanup', async () => {
    const oldRoom = mkRoomId();
    const freshRoom = mkRoomId();

    const uidEmptyAfter = mkUid('empty');
    const uidKeepOther = mkUid('keep');
    const uidFresh = mkUid('fresh');

    // rooms
    await adminSet(env, `/rooms/${oldRoom}`, {
      private: { creator_uid: 'c', responder_uid: 'r', created_at: nowMs() - 2 * 60 * 60 * 1000 },
      meta: { state: 2 },
    });

    await adminSet(env, `/rooms/${freshRoom}`, {
      private: { creator_uid: 'c', responder_uid: 'r', created_at: nowMs() - 10 * 60 * 1000 },
      meta: { state: 2 },
    });

    // userspace: uidEmptyAfter has ONLY old slot -> expect whole /{uid} removed
    await adminSet(env, `/${uidEmptyAfter}`, {
      create: { room_id: 'r1', created_at: nowMs() - 2 * 60 * 60 * 1000 },
    });

    // userspace: uidKeepOther has old slot AND other data -> expect only slot removed, user node remains
    await adminSet(env, `/${uidKeepOther}`, {
      join: { room_id: 'r2', created_at: nowMs() - 2 * 60 * 60 * 1000 },
      profile: { nick: 'x' },
    });

    // userspace: uidFresh has fresh slot -> should stay
    await adminSet(env, `/${uidFresh}`, {
      create: { room_id: 'r3', created_at: nowMs() - 5 * 60 * 1000 },
    });

    const res = await runJanitorOnce({ maxAgeMs: 60 * 60 * 1000 });
    expect(res.roomsDeleted).toBeGreaterThanOrEqual(1);
    expect(res.cutoff).toBeTypeOf('number');

    // rooms assertions
    const oldRoomSnap = await adminGet(env, `/rooms/${oldRoom}`);
    expect(oldRoomSnap.exists).toBe(false);

    const freshRoomSnap = await adminGet(env, `/rooms/${freshRoom}`);
    expect(freshRoomSnap.exists).toBe(true);

    // userspace assertions
    const u1 = await adminGet(env, `/${uidEmptyAfter}`);
    expect(u1.exists).toBe(false);

    const u2 = await adminGet(env, `/${uidKeepOther}`);
    expect(u2.exists).toBe(true);
    const u2Val = isRecord(u2.val) ? u2.val : {};
    expect(u2Val.join).toBeUndefined();
    const u2Profile = isRecord(u2Val.profile) ? u2Val.profile : {};
    expect(u2Profile.nick).toBe('x');

    const u3 = await adminGet(env, `/${uidFresh}`);
    expect(u3.exists).toBe(true);
    const u3Val = isRecord(u3.val) ? u3.val : {};
    const u3Create = isRecord(u3Val.create) ? u3Val.create : {};
    expect(u3Create.room_id).toBe('r3');
  });
});
