/** biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: integration-e2e */

import { randomBytes } from 'node:crypto';
import { type Database, type DataSnapshot, get, onValue, ref } from 'firebase/database';
import { uint8ArrayToBase64 } from 'uint8array-extras';
import { describe, expect, it } from 'vitest';
import { RtdbOnlineRunner } from '../../../adapters/firebase/rtdb-online-runner';
import { RtdbRoomRepository } from '../../../adapters/firebase/rtdb-room-repository';
import { CpaceEngine } from '../../../adapters/pake-engine/cpace';
import { SimplePeerEngine } from '../../../adapters/webrtc-engine/simple-peer';
import { getTestEnv } from '../../../tests/setup/integration-firebase';

import type { P2pChannel } from '../../ports/p2p-channel';
import { CreateRoomUseCase } from '../../use-cases/create-room';
import { JoinRoomUseCase } from '../../use-cases/join-room';

function toU8(x: unknown): Uint8Array {
  if (x instanceof Uint8Array) return new Uint8Array(x);
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(x)) return new Uint8Array(x);
  throw new Error(`Expected Uint8Array/Buffer, got ${Object.prototype.toString.call(x)}`);
}

function onceReceive(ch: P2pChannel): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const unsub = ch.onReceive((d) => {
      try {
        unsub();
      } catch {}
      resolve(d);
    });
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

async function waitInfoConnected(
  db: Database,
  expected: boolean,
  timeoutMs = 7_000,
): Promise<void> {
  const r = ref(db, '.info/connected');

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let unsub: (() => void) | undefined;

    const cleanup = () => {
      try {
        unsub?.();
      } catch {}
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Timed out waiting for .info/connected=${expected} after ${timeoutMs}ms`));
    }, timeoutMs);

    const onSnap = (s: DataSnapshot) => {
      if (settled) return;
      if (s.exists() && s.val() === expected) {
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve();
      }
    };

    unsub = onValue(r, onSnap, (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(err);
    });
  });
}

async function waitRoomStateAtLeastAdmin(
  env: any,
  roomId: string,
  minState: number,
  timeoutMs = 15_000,
  intervalMs = 100,
): Promise<number> {
  const start = Date.now();
  let last: unknown;

  while (Date.now() - start < timeoutMs) {
    let stateVal: unknown;

    await env.withSecurityRulesDisabled(async (ctx: any) => {
      const adminDb = ctx.database() as unknown as Database;
      const snap = await get(ref(adminDb, `/rooms/${roomId}/meta/state`));
      stateVal = snap.exists() ? snap.val() : undefined;
    });

    last = stateVal;

    const n = Number(stateVal);
    if (Number.isFinite(n) && n >= minState) return n;

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(
    `meta/state did not reach >=${minState} within ${timeoutMs}ms; roomId=${roomId}; last=${String(
      last,
    )}`,
  );
}

async function waitRoomDeletedAdmin(
  env: any,
  roomId: string,
  timeoutMs = 20_000,
  intervalMs = 150,
): Promise<void> {
  const start = Date.now();
  let last: unknown;

  while (Date.now() - start < timeoutMs) {
    let exists = true;
    let val: unknown;

    await env.withSecurityRulesDisabled(async (ctx: any) => {
      const adminDb = ctx.database() as unknown as Database;
      const snap = await get(ref(adminDb, `/rooms/${roomId}`));
      exists = snap.exists();
      val = snap.val();
    });

    last = { exists, val };

    if (!exists) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(
    `Room was not deleted within ${timeoutMs}ms; roomId=${roomId}; lastState=${JSON.stringify(
      last,
    )}`,
  );
}

describe('rooms handshake integration (happy path)', () => {
  const mkUid = (p: string) => `${p}_${Math.random().toString(16).slice(2, 10)}`;

  const mkRoomIdB64u = () => {
    // base64url, безопасно для RTDB key и для base64ToUint8Array()
    return uint8ArrayToBase64(randomBytes(16), { urlSafe: true });
  };

  it('Create + Join succeed; runners bring db online during run and offline after; room deleted after finalize', async () => {
    const env = getTestEnv();

    const ownerUid = mkUid('owner');
    const responderUid = mkUid('responder');
    const roomId = mkRoomIdB64u();

    // initial: комнаты не существует
    await env.withSecurityRulesDisabled(async (ctx: any) => {
      const adminDb = ctx.database() as unknown as Database;
      const snap = await get(ref(adminDb, `/rooms/${roomId}`));
      expect(snap.exists()).toBe(false);
    });

    const ownerDb = env.authenticatedContext(ownerUid).database() as unknown as Database;
    const responderDb = env.authenticatedContext(responderUid).database() as unknown as Database;

    const roomsRepoOwner = new RtdbRoomRepository(ownerDb);
    const roomsRepoResponder = new RtdbRoomRepository(responderDb);

    const ownerRunner = new RtdbOnlineRunner(ownerDb);
    const responderRunner = new RtdbOnlineRunner(responderDb);

    const wrtcMod = await import('@avahq/wrtc');
    const wrtc = (wrtcMod as any).default ?? wrtcMod;

    // ВАЖНО: если не починил SimplePeerEngine (см. замечание выше), этот rtcConfig сейчас НЕ применяется.
    const rtcConfig: RTCConfiguration = { iceServers: [] };

    const webRtcOwner = new SimplePeerEngine({ rtcConfig, wrtc });
    const webRtcResponder = new SimplePeerEngine({ rtcConfig, wrtc });

    const pakeOwner = new CpaceEngine();
    const pakeResponder = new CpaceEngine();

    const timeoutMs = 20_000;
    const waitSecondSideMs = 30_000;

    const createUc = new CreateRoomUseCase(
      roomsRepoOwner,
      pakeOwner,
      webRtcOwner,
      timeoutMs,
      waitSecondSideMs,
    );

    const joinUc = new JoinRoomUseCase(
      roomsRepoResponder,
      pakeResponder,
      webRtcResponder,
      timeoutMs,
    );

    // 1) стартуем creator (он создаст room и дойдёт до waitB)
    const ownerTask = ownerRunner.run(async () => {
      await waitInfoConnected(ownerDb, true);
      return await createUc.run(ownerUid, roomId);
    });

    // 2) гарантируем, что room уже создан (state>=1), иначе join может “потеряться” из-за триггера
    await waitRoomStateAtLeastAdmin(env, roomId, 1, 15_000);

    // 3) стартуем responder
    const responderTask = responderRunner.run(async () => {
      await waitInfoConnected(responderDb, true);
      return await joinUc.run(responderUid, roomId);
    });

    const [chOwner, chResponder] = await Promise.all([ownerTask, responderTask]);

    // 4) после завершения runner'ов соединение должно быть offline
    await waitInfoConnected(ownerDb, false);
    await waitInfoConnected(responderDb, false);

    // 5) комната должна быть удалена функцией deleteRoomOnFinalized (после state=3)
    await waitRoomDeletedAdmin(env, roomId, 25_000);

    // 6) проверяем канал
    const aToB = withTimeout(onceReceive(chResponder), 5_000, 'timeout waiting A->B');
    const bToA = withTimeout(onceReceive(chOwner), 5_000, 'timeout waiting B->A');

    chOwner.send(new Uint8Array([1, 2, 3]));
    chResponder.send(new Uint8Array([9, 8, 7]));

    expect(Array.from(toU8(await aToB))).toEqual([1, 2, 3]);
    expect(Array.from(toU8(await bToA))).toEqual([9, 8, 7]);
  });
});
