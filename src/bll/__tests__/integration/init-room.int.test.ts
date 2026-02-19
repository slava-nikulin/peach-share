/** biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: <explanation> */
import { assertSucceeds } from '@firebase/rules-unit-testing';
import { type Database, get, ref, set } from 'firebase/database';
import { uint8ArrayToBase64 } from 'uint8array-extras';
import { beforeAll, describe, expect, it } from 'vitest';
import { Argon2idNodeRoomIdKdf } from '../../../adapters/argon-kdf/argon2id.node';
import { RtdbRoomRepository } from '../../../adapters/firebase/rtdb-room-repository';
import { DrandOtpClient } from '../../../adapters/otp-drand';

import { getTestEnv } from '../../../tests/setup/integration-firebase';
import { InitRoomUseCase } from '../../use-cases/init-room';

type GlobalWithDrand = typeof globalThis & {
  __drandMock?: { baseUrl: string; requests: string[] };
};

let kdf: Argon2idNodeRoomIdKdf;

async function waitForRoomCreated(params: {
  env: ReturnType<typeof getTestEnv>;
  roomId: string;
  timeoutMs?: number;
  intervalMs?: number;
}) {
  const { env, roomId, timeoutMs = 10_000, intervalMs = 100 } = params;

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let room: unknown;

    await env.withSecurityRulesDisabled(async (ctx: any) => {
      const adminDb = ctx.database() as unknown as Database;
      const snap = await get(ref(adminDb, `/rooms/${roomId}`));
      room = snap.exists() ? snap.val() : undefined;
    });

    if (room !== undefined) return room as any;

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`Room was not created within ${timeoutMs}ms: ${roomId}`);
}

beforeAll(async () => {
  kdf = new Argon2idNodeRoomIdKdf();

  // прогреть wasm/argon, чтобы первый вызов не влиял на тайминги теста
  await kdf.deriveRoomId('warmup', new Uint8Array(32));
});

describe('InitRoomUseCase integration: join when room exists', () => {
  it('creates room via trigger, then usecase returns join with same roomId', async () => {
    const env = getTestEnv();

    const g = globalThis as GlobalWithDrand;
    if (!g.__drandMock) throw new Error('drand-mock not initialized');

    const otp = new DrandOtpClient({
      baseUrl: g.__drandMock.baseUrl,
      beaconId: 'quicknet',
      timeoutMs: 2_000,
    });
    const uid = `u_${Math.random().toString(16).slice(2, 10)}`;
    const userDb = env.authenticatedContext(uid).database() as unknown as Database;

    const repo = new RtdbRoomRepository(userDb);
    const uc = new InitRoomUseCase(repo, kdf, otp);

    // вычисляем roomId так же, как usecase (id0 на latest round)
    const prs = 'prs';
    const [rnd0] = await otp.getOtp();
    const roomId = uint8ArrayToBase64(await kdf.deriveRoomId(prs, rnd0), { urlSafe: true });

    // создаём комнату “как пользователь” через trigger slot: /{uid}/create -> /rooms/{roomId}
    await assertSucceeds(
      set(ref(userDb, `/${uid}/create`), {
        room_id: roomId,
        created_at: Date.now(),
      }),
    );

    const room = await waitForRoomCreated({ env, roomId });
    expect(room).toBeTruthy();
    expect(room.private?.creator_uid).toBe(uid);
    expect(room.meta?.state).toBe(1);

    expect(await repo.roomExists(roomId)).toBe(true);

    // проверяем join-ветку usecase
    g.__drandMock.requests.length = 0;

    const res = await uc.run(prs);
    expect(res).toEqual({ intent: 'join', roomId });

    expect(g.__drandMock.requests).toContain('GET /v2/beacons/quicknet/rounds/latest');
    expect(g.__drandMock.requests.filter((x) => x.includes('/rounds/')).length).toBe(1);
  });

  it('returns create when no rooms exist for latest and previous windows', async () => {
    const env = getTestEnv();

    const g = globalThis as GlobalWithDrand;
    if (!g.__drandMock) throw new Error('drand-mock not initialized');

    const otp = new DrandOtpClient({
      baseUrl: g.__drandMock.baseUrl,
      beaconId: 'quicknet',
      timeoutMs: 2_000,
    });

    const uid = `u_${Math.random().toString(16).slice(2, 10)}`;
    const userDb = env.authenticatedContext(uid).database() as unknown as Database;

    const repo = new RtdbRoomRepository(userDb);

    const uc = new InitRoomUseCase(repo, kdf, otp);

    // уникальный prs, чтобы гарантированно не совпасть с другими тестами
    const prs = `prs_${Math.random().toString(16).slice(2, 10)}`;

    // заранее вычисляем ожидаемый id0 (чтобы не загрязнять drand requests после запуска usecase)
    const [rnd0, round] = await otp.getOtp();
    const id0 = uint8ArrayToBase64(await kdf.deriveRoomId(prs, rnd0), { urlSafe: true });

    // сбрасываем логи запросов — далее считаем только вызовы usecase
    g.__drandMock.requests.length = 0;

    const res = await uc.run(prs);

    expect(res).toEqual({ intent: 'create', roomId: id0 });

    // usecase должен дернуть latest + предыдущие 3 окна (при round=42 это 41/40/39)
    expect(g.__drandMock.requests).toContain('GET /v2/beacons/quicknet/rounds/latest');
    expect(g.__drandMock.requests).toContain(`GET /v2/beacons/quicknet/rounds/${round - 1}`);
    expect(g.__drandMock.requests).toContain(`GET /v2/beacons/quicknet/rounds/${round - 2}`);
    expect(g.__drandMock.requests).toContain(`GET /v2/beacons/quicknet/rounds/${round - 3}`);

    // и всего должно быть 4 drand-запроса в этом сценарии
    expect(g.__drandMock.requests.filter((x) => x.includes('/rounds/')).length).toBe(4);
  });
});
