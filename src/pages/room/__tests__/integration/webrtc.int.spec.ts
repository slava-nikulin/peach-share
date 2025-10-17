import { child, get, ref, remove } from 'firebase/database';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { importAesGcmKey, pushEncrypted, sigPaths } from '../../../../lib/crypto-webrtc';
import { type RtcEndpoint, setupWebRTC } from '../../../../lib/webrtc';
import { setupTestEnv } from '../../../../tests/setup/env';
import { startEmu, stopEmu } from '../../../../tests/setup/testcontainers';
import {
  cleanupTestFirebaseUsers,
  createTestFirebaseUser,
  type TestFirebaseUserCtx,
} from '../../../../tests/utils/firebase-user';
import { createRoom } from '../../fsm-actors/create-room';
import { joinRoom } from '../../fsm-actors/join-room';

const NON_EMPTY = /\S/;
const SIXTY_SEC = 60_000;

const stunFromEnv = (): RTCIceServer[] => {
  const raw = process.env.VITE_STUN_URLS || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((urls) => ({ urls }));
};

const waitReady = (ep: RtcEndpoint): Promise<void> => ep.ready;

describe('setupWebRTC integration', () => {
  let emu: Awaited<ReturnType<typeof startEmu>>;
  let cleanupEnv: { restore: () => void };
  const roomsToCleanup: Array<{ roomId: string; ctx: TestFirebaseUserCtx }> = [];
  const activeUsers: TestFirebaseUserCtx[] = [];

  beforeAll(async () => {
    vi.useRealTimers();
    emu = await startEmu();
    cleanupEnv = setupTestEnv({
      hostname: emu.host,
      dbPort: emu.ports.db,
      authPort: emu.ports.auth,
      stunPort: emu.ports.stun, // host-network или проброшенный UDP
      stunHost: emu.stunHost ?? emu.host,
    });
    vi.resetModules();
    await import('../../config/firebase');
  }, 180_000);

  afterAll(async () => {
    cleanupEnv?.restore?.();
    if (emu) {
      await stopEmu(emu);
    }
  }, 120_000);

  afterEach(async () => {
    if (roomsToCleanup.length > 0) {
      const entries = roomsToCleanup.splice(0);
      await Promise.all(
        entries.map(({ roomId, ctx }) => remove(ref(ctx.db, `rooms/${roomId}`)).catch(() => {})),
      );
    }
    if (activeUsers.length > 0) {
      const users = activeUsers.splice(0);
      await cleanupTestFirebaseUsers(users);
    }
  }, 60_000);

  it('owner <-> guest: ready, JSON и бинарь ходят, сигналинг в RTDB создан', async () => {
    const roomId = `room-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const ownerCtx = await createTestFirebaseUser('owner');
    const guestCtx = await createTestFirebaseUser('guest');
    activeUsers.push(ownerCtx, guestCtx);
    roomsToCleanup.push({ roomId, ctx: ownerCtx });
    const ownerRoomRef = ref(ownerCtx.db, `rooms/${roomId}`);
    const guestRoomRef = ref(guestCtx.db, `rooms/${roomId}`);
    const encKey = new Uint8Array(32).fill(7);
    const iceServers = stunFromEnv(); // для реализма; можно оставить []

    await createRoom({ roomId, authId: ownerCtx.uid }, { db: ownerCtx.db });
    await joinRoom({ roomId, authId: guestCtx.uid }, { db: guestCtx.db });

    const ownerP = setupWebRTC({
      dbRoomRef: ownerRoomRef,
      role: 'owner',
      encKey,
      timeoutMs: SIXTY_SEC,
      stun: iceServers,
    });
    const guestP = setupWebRTC({
      dbRoomRef: guestRoomRef,
      role: 'guest',
      encKey,
      timeoutMs: SIXTY_SEC,
      stun: iceServers,
    });

    const [owner, guest] = await Promise.all([ownerP, guestP]);
    await Promise.all([waitReady(owner), waitReady(guest)]);

    // JSON round-trip
    const onceJSON = (ep: RtcEndpoint): Promise<unknown> =>
      new Promise<unknown>((resolve) => {
        const unsubscribe = ep.onJSON((message) => {
          unsubscribe();
          resolve(message);
        });
      });

    const recv1 = onceJSON(guest);
    owner.sendJSON({ t: 'ping', n: 1 });
    expect(await recv1).toMatchObject({ t: 'ping', n: 1 });

    const recv2 = onceJSON(owner);
    guest.sendJSON({ t: 'pong', n: 2 });
    expect(await recv2).toMatchObject({ t: 'pong', n: 2 });

    // бинарный round-trip
    const onceBin = (ep: RtcEndpoint): Promise<ArrayBuffer> =>
      new Promise<ArrayBuffer>((resolve) => {
        const unsubscribe = ep.onBinary((buffer) => {
          unsubscribe();
          resolve(buffer);
        });
      });

    const bin = new Uint8Array([1, 2, 3, 4]).buffer;
    const recvB = onceBin(guest);
    owner.sendBinary(bin);
    const gotB = await recvB;
    expect(new Uint8Array(gotB)).toEqual(new Uint8Array(bin));

    // сигналинг в RTDB
    const wrtcBase = child(ownerRoomRef, 'webrtc');
    const offerOwner = await get(child(child(wrtcBase, 'offer'), 'owner'));
    const answerGuest = await get(child(child(wrtcBase, 'answer'), 'guest'));
    expect(offerOwner.exists()).toBe(true);
    expect(answerGuest.exists()).toBe(true);
    expect(offerOwner.val()?.msg_b64).toMatch(NON_EMPTY);
    expect(answerGuest.val()?.msg_b64).toMatch(NON_EMPTY);

    const candsOwner = await get(child(child(wrtcBase, 'candidates'), 'owner'));
    const candsGuest = await get(child(child(wrtcBase, 'candidates'), 'guest'));
    expect(candsOwner.exists()).toBe(true);
    expect(candsGuest.exists()).toBe(true);
    expect(Object.keys(candsOwner.val() ?? {})).not.toHaveLength(0);
    expect(Object.keys(candsGuest.val() ?? {})).not.toHaveLength(0);

    owner.close();
    guest.close();
  }, 180_000);

  it('очередь ICE-кандидатов до setRemoteDescription: соединение устанавливается', async () => {
    const roomId = `room-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const ownerCtx = await createTestFirebaseUser('owner');
    const guestCtx = await createTestFirebaseUser('guest');
    activeUsers.push(ownerCtx, guestCtx);
    roomsToCleanup.push({ roomId, ctx: ownerCtx });
    const ownerRoomRef = ref(ownerCtx.db, `rooms/${roomId}`);
    const guestRoomRef = ref(guestCtx.db, `rooms/${roomId}`);
    const encKey = new Uint8Array(32).fill(8);
    const aes = await importAesGcmKey(encKey);
    const ownerPaths = sigPaths({ roomRef: ownerRoomRef, role: 'owner' });

    await createRoom({ roomId, authId: ownerCtx.uid }, { db: ownerCtx.db });
    await joinRoom({ roomId, authId: guestCtx.uid }, { db: guestCtx.db });

    // стартуем guest раньше, чтобы подписался на кандидатов и оффер
    const guestP = setupWebRTC({
      dbRoomRef: guestRoomRef,
      role: 'guest',
      encKey,
      timeoutMs: SIXTY_SEC,
      stun: stunFromEnv(),
    });

    // пушим "ранний" кандидат владельца до оффера
    await pushEncrypted(ownerPaths.myCandidatesRef, aes, {
      candidate: 'candidate:0 1 UDP 2122252543 127.0.0.1 55555 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0,
    });

    // теперь стартуем owner
    const ownerP = setupWebRTC({
      dbRoomRef: ownerRoomRef,
      role: 'owner',
      encKey,
      timeoutMs: SIXTY_SEC,
      stun: stunFromEnv(),
    });

    const [guest, owner] = await Promise.all([guestP, ownerP]);
    await Promise.all([waitReady(owner), waitReady(guest)]);

    owner.close();
    guest.close();
  }, 120_000);

  it('неверный ключ шифрования: setupWebRTC падает', async () => {
    const roomId = `room-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const ownerCtx = await createTestFirebaseUser('owner');
    const guestCtx = await createTestFirebaseUser('guest');
    activeUsers.push(ownerCtx, guestCtx);
    roomsToCleanup.push({ roomId, ctx: ownerCtx });
    const ownerRoomRef = ref(ownerCtx.db, `rooms/${roomId}`);
    const guestRoomRef = ref(guestCtx.db, `rooms/${roomId}`);

    const encOwner = new Uint8Array(32).fill(1);
    const encGuest = new Uint8Array(32).fill(2); // другой ключ

    await createRoom({ roomId, authId: ownerCtx.uid }, { db: ownerCtx.db });
    await joinRoom({ roomId, authId: guestCtx.uid }, { db: guestCtx.db });

    const ownerP = setupWebRTC({
      dbRoomRef: ownerRoomRef,
      role: 'owner',
      encKey: encOwner,
      timeoutMs: 15_000,
      stun: stunFromEnv(),
    });
    const guestP = setupWebRTC({
      dbRoomRef: guestRoomRef,
      role: 'guest',
      encKey: encGuest,
      timeoutMs: 15_000,
      stun: stunFromEnv(),
    });

    const [ownerResult, guestResult] = await Promise.allSettled([ownerP, guestP]);
    expect(ownerResult.status).toBe('rejected');
    if (ownerResult.status === 'rejected') {
      expect(ownerResult.reason).toBeTruthy();
    }
    expect(guestResult.status).toBe('rejected');
    if (guestResult.status === 'rejected') {
      expect(guestResult.reason).toBeTruthy();
    }
  }, 40_000);
});
