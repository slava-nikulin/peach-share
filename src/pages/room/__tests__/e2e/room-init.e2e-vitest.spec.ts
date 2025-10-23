import { type Database, get, ref, remove } from 'firebase/database';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { toBase64Url } from '../../../../lib/crypto';
import type { RtcEndpoint } from '../../../../lib/webrtc';
import { setupTestEnv } from '../../../../tests/setup/env';
import { startEmu, stopEmu } from '../../../../tests/setup/testcontainers';
import type { RoomInitActor } from '../../room-fsm';
import type { RoomRecord } from '../../types';

type StartRoomFlow = typeof import('../../room-init').startRoomFlow;
type RoomInitSnapshot = ReturnType<RoomInitActor['getSnapshot']>;
interface DHSnapshot {
  owner: { msg_b64: string; nonce_b64: string };
  guest: { msg_b64: string; nonce_b64: string };
  mac: {
    owner: { mac_b64: string };
    guest: { mac_b64: string };
  };
  status: { ok: boolean };
}

const SIX_DIGIT_REGEX = /^\d{6}$/;
const NON_EMPTY_REGEX = /\S/;

const timeout = (label: string, ms: number): Promise<never> =>
  new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      clearTimeout(timer);
      reject(new Error(label));
    }, ms);
  });

const withTimeout = <T>(promise: Promise<T>, label: string, ms: number = 10_000): Promise<T> =>
  Promise.race([promise, timeout(label, ms)]);

interface RoomInitErrorContext {
  lastError?: { at?: string; message?: string };
}

const untilDone = (actor: RoomInitActor, timeoutMs: number = 120_000): Promise<void> =>
  new Promise((res, rej) => {
    let timer: ReturnType<typeof setTimeout>;
    const sub = actor.subscribe((s) => {
      if (s.status === 'done') {
        clearTimeout(timer);
        sub.unsubscribe();
        return res();
      }
      if (s.matches?.('failed') || s.status === 'error') {
        clearTimeout(timer);
        sub.unsubscribe();
        const contextWithError = s.context as Partial<RoomInitErrorContext> | undefined;
        const le = contextWithError?.lastError;
        return rej(
          new Error(`actor_failed at ${le?.at ?? 'unknown'}: ${le?.message ?? 'no message'}`),
        );
      }
    });
    timer = setTimeout(() => {
      sub.unsubscribe();
      rej(new Error('timeout: actor did not reach done'));
    }, timeoutMs);
  });

const readRoom = async (db: Database, roomId: string): Promise<Record<string, unknown> | null> => {
  const snap = await get(ref(db, `rooms/${roomId}`));
  return snap.exists() ? (snap.val() as Record<string, unknown>) : null;
};

describe('room init e2e (concurrent)', () => {
  let db: Database;
  let emu: Awaited<ReturnType<typeof startEmu>>;
  let cleanupEnv: { restore: () => void };

  let startRoomFlow: StartRoomFlow;

  const createdRoomIds: string[] = [];

  beforeAll(async () => {
    vi.useRealTimers();
    emu = await startEmu();
    cleanupEnv = setupTestEnv({
      hostname: emu.host,
      dbPort: emu.ports.db,
      authPort: emu.ports.auth,
      stunPort: emu.ports.stun,
      stunHost: emu.stunHost ?? emu.host,
    });

    vi.resetModules();

    ({ db } = await import('../../config/firebase'));
    ({ startRoomFlow } = await import('../../room-init'));
  }, 240_000);

  afterEach(async () => {
    if (!db || createdRoomIds.length === 0) return;
    const ids = createdRoomIds.splice(0);
    await Promise.all(ids.map((roomId) => remove(ref(db, `rooms/${roomId}`))));
  }, 60_000);

  afterAll(async () => {
    cleanupEnv?.restore?.();
    if (emu) {
      await stopEmu(emu);
    }
  }, 60_000);

  it('create & join concurrently; both reach done; same room_id; no errors', async () => {
    const roomId = `room-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    createdRoomIds.push(roomId);

    const secret = toBase64Url(new Uint8Array(32).fill(7));
    const errors: string[] = [];
    const onErr = (m: string | null): void => {
      if (m) errors.push(m);
    };

    // одновременный старт — join сам подождёт появления записи
    const creator = startRoomFlow({ roomId, intent: 'create', secret }, onErr);
    const joiner = startRoomFlow({ roomId, intent: 'join', secret }, onErr);
    const cVM = creator.vm;
    const jVM = joiner.vm;

    await Promise.all([untilDone(creator.actor), untilDone(joiner.actor)]);

    const cCtx: RoomInitSnapshot['context'] = creator.actor.getSnapshot().context;
    const jCtx: RoomInitSnapshot['context'] = joiner.actor.getSnapshot().context;

    expect(cCtx.room).toBeDefined();
    expect(jCtx.room).toBeDefined();

    const cRoom = cCtx.room as RoomRecord;
    const jRoom = jCtx.room as RoomRecord;

    expect(cRoom.room_id).toBe(roomId);
    expect(jRoom.room_id).toBe(roomId);
    expect(jRoom.owner).toBe(cRoom.owner);

    const stored = await readRoom(db, roomId);
    expect(stored?.room_id).toBe(roomId);
    expect(stored?.owner).toBe(cRoom.owner);

    // --- DH: проверяем результат в контексте
    expect(cCtx.encKey).toBeDefined();
    expect(jCtx.encKey).toBeDefined();
    expect(Array.from(cCtx.encKey as Uint8Array)).toEqual(Array.from(jCtx.encKey as Uint8Array));
    expect((cCtx.encKey as Uint8Array).length).toBe(32);

    expect(cCtx.sas).toBeDefined();
    expect(jCtx.sas).toBeDefined();
    expect(cCtx.sas).toMatch(SIX_DIGIT_REGEX);
    expect(cCtx.sas).toBe(jCtx.sas);

    // --- DH: проверяем артефакты в RTDB
    const dhPath = `rooms/${roomId}/dh`;
    const dhSnap = await get(ref(db, dhPath));
    expect(dhSnap.exists()).toBe(true);

    const dh = dhSnap.val() as DHSnapshot;

    // handshakes
    expect(typeof dh.owner?.msg_b64).toBe('string');
    expect(typeof dh.owner?.nonce_b64).toBe('string');
    expect(typeof dh.guest?.msg_b64).toBe('string');
    expect(typeof dh.guest?.nonce_b64).toBe('string');

    // macs
    expect(typeof dh.mac?.owner?.mac_b64).toBe('string');
    expect(typeof dh.mac?.guest?.mac_b64).toBe('string');
    expect(dh.mac.owner.mac_b64).not.toBe(dh.mac.guest.mac_b64); // метки A/B различны

    // статус
    expect(dh.status?.ok).toBe(true);

    //viewModel
    // Флаги пайплайна
    expect(cVM.isRoomCreated()).toBe(true);
    expect(jVM.isRoomCreated()).toBe(true);

    expect(cVM.isRtcReady()).toBe(true);
    expect(jVM.isRtcReady()).toBe(true);

    expect(cVM.isCleanupDone()).toBe(true);
    expect(jVM.isCleanupDone()).toBe(true);

    expect(cVM.isRtcReady()).toBe(true);
    expect(jVM.isRtcReady()).toBe(true);

    // // Auth IDs заданы и отличаются
    // expect(typeof cVM.authId()).toBe('string');
    // expect(typeof jVM.authId()).toBe('string');
    // expect(cVM.authId()).not.toBe(jVM.authId());

    // Секрет прокинут во VM
    expect(cVM.secret()).toBe(secret);
    expect(jVM.secret()).toBe(secret);

    // SAS: 6 цифр и совпадают
    expect(cVM.sas()).toMatch(SIX_DIGIT_REGEX);
    expect(jVM.sas()).toMatch(SIX_DIGIT_REGEX);
    expect(cVM.sas()).toBe(jVM.sas());

    // --- WebRTC signaling в RTDB
    const wrtcBase = `rooms/${roomId}/webrtc`;

    // offer от owner
    const offerOwner = await get(ref(db, `${wrtcBase}/offer/owner`));
    expect(offerOwner.exists()).toBe(true);
    expect(offerOwner.val()?.msg_b64).toMatch(NON_EMPTY_REGEX);
    expect(offerOwner.val()?.nonce_b64).toMatch(NON_EMPTY_REGEX);

    // answer от guest
    const answerGuest = await get(ref(db, `${wrtcBase}/answer/guest`));
    expect(answerGuest.exists()).toBe(true);
    expect(answerGuest.val()?.msg_b64).toMatch(NON_EMPTY_REGEX);
    expect(answerGuest.val()?.nonce_b64).toMatch(NON_EMPTY_REGEX);

    // ICE-кандидаты обеих сторон (хватает >=1)
    const candsOwner = await get(ref(db, `${wrtcBase}/candidates/owner`));
    const candsGuest = await get(ref(db, `${wrtcBase}/candidates/guest`));
    expect(candsOwner.exists()).toBe(true);
    expect(candsGuest.exists()).toBe(true);
    expect(Object.keys(candsOwner.val() ?? {})).not.toHaveLength(0);
    expect(Object.keys(candsGuest.val() ?? {})).not.toHaveLength(0);

    // --- WebRTC DataChannel: JSON round-trip
    const cEp = (cCtx as { rtcEndPoint?: RtcEndpoint }).rtcEndPoint;
    const jEp = (jCtx as { rtcEndPoint?: RtcEndpoint }).rtcEndPoint;

    expect(cEp).toBeDefined();
    expect(jEp).toBeDefined();
    if (!cEp || !jEp) {
      throw new Error('RTC endpoint not available');
    }

    // на всякий случай дождёмся готовности, если startRTC не делал await endpoint.ready
    await Promise.all([cEp.ready.catch(() => {}), jEp.ready.catch(() => {})]);

    const onceJSON = (ep: RtcEndpoint): Promise<unknown> =>
      new Promise((resolve) => {
        const unsubscribe = ep.onJSON((message) => {
          unsubscribe();
          resolve(message);
        });
      });

    const payload = { t: 'ping', ts: Date.now(), from: 'creator' };

    // creator -> guest
    const recv1 = onceJSON(jEp);
    cEp.sendJSON(payload);
    const got1 = await withTimeout(recv1, 'dc timeout 1');
    expect(got1).toMatchObject({ t: 'ping', from: 'creator' });

    // guest -> creator
    const recv2 = onceJSON(cEp);
    jEp.sendJSON({ t: 'pong', ts: Date.now(), from: 'guest' });
    const got2 = await withTimeout(recv2, 'dc timeout 2');
    expect(got2).toMatchObject({ t: 'pong', from: 'guest' });

    // бинарный кадр
    const bin = new Uint8Array([1, 2, 3, 4]).buffer;
    const onceBin = (ep: RtcEndpoint): Promise<ArrayBuffer> =>
      new Promise((resolve) => {
        const unsubscribe = ep.onBinary((buffer) => {
          unsubscribe();
          resolve(buffer);
        });
      });

    const brcv = onceBin(jEp);
    cEp.sendBinary(bin);
    const bgot = await withTimeout(brcv, 'dc timeout bin');
    expect(new Uint8Array(bgot)).toEqual(new Uint8Array(bin));

    expect(errors).toHaveLength(0);

    creator.stop();
    joiner.stop();
  }, 180_000);
});
