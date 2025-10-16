import { describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { fromPromise } from 'xstate/actors';
import type { RtcEndpoint } from '../../../../lib/webrtc';
import { roomInitFSM } from '../../room-fsm';
import type { RoomRecord } from '../../types';

const noopUnsubscribe = (): void => undefined;

const dummyEp = (): RtcEndpoint => ({
  pc: {} as unknown as RTCPeerConnection,
  channel: {} as unknown as RTCDataChannel,
  sendJSON: vi.fn(),
  sendBinary: vi.fn(),
  onJSON: (_fn: (payload: unknown) => void): (() => void) => noopUnsubscribe,
  onBinary: (_fn: (buf: ArrayBuffer) => void): (() => void) => noopUnsubscribe,
  close: vi.fn(),
  ready: Promise.resolve(),
});

describe('room-fsm component tests', () => {
  const enc32 = (v: number = 7): Uint8Array => new Uint8Array(32).fill(v);

  it('happy path (create): auth → create → dh → rtc → cleanup → done', async () => {
    const seen: string[] = [];
    const called = {
      createRoom: vi.fn(),
      joinRoom: vi.fn(),
      vmRoomReady: vi.fn(),
      vmDHDone: vi.fn(),
      vmRtcDone: vi.fn(), // NEW
    };

    const roomMock: RoomRecord = {
      room_id: 'r1',
      owner: 'auth_uid',
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    const ep = dummyEp(); // NEW

    const fsm = roomInitFSM.provide({
      actors: {
        auth: fromPromise(async () => ({ authId: 'auth_uid' })),
        createRoom: fromPromise(
          async ({ input }: { input: { roomId: string; authId: string } }) => {
            called.createRoom(input);
            return { roomReady: true, room: roomMock };
          },
        ),
        joinRoom: fromPromise(async () => {
          called.joinRoom();
          return { roomReady: true, room: roomMock };
        }),
        dh: fromPromise(async () => ({ encKey: enc32(1), sas: '123456' })),
        rtc: fromPromise(async () => ({ rtcReady: true, endpoint: ep })), // NEW
        cleanup: fromPromise(async () => ({ cleanupDone: true })),
      },
      actions: {
        vmRoomReady: () => called.vmRoomReady(),
        vmDHDone: () => called.vmDHDone(),
        vmRtcDone: () => called.vmRtcDone(), // NEW
      },
    });

    const actor = createActor(fsm, { input: { roomId: 'r1', intent: 'create', secret: 's' } });
    const completion = new Promise<void>((resolve, reject) => {
      const sub = actor.subscribe((s) => {
        s.tags.forEach((t) => {
          seen.push(t);
        });
        if (s.status === 'done') {
          sub.unsubscribe();
          resolve();
        } else if (s.status === 'error') {
          sub.unsubscribe();
          reject(s.error ?? new Error('roomInitFSM actor failed'));
        }
      });
    });

    actor.start();
    await completion;

    const snap = actor.getSnapshot();
    expect(snap.status).toBe('done');
    expect(snap.context.authId).toBe('auth_uid');
    expect(seen).toEqual(expect.arrayContaining(['creating', 'dh', 'rtc', 'cleanup']));
    expect(called.createRoom).toHaveBeenCalledWith({ roomId: 'r1', authId: 'auth_uid' });
    expect(called.joinRoom).not.toHaveBeenCalled();
    expect(called.vmRoomReady).toHaveBeenCalledTimes(1);

    // setRoom
    expect(snap.context.room).toEqual(roomMock);

    // setDHResult
    expect(snap.context.encKey).toBeInstanceOf(Uint8Array);
    expect((snap.context.encKey as Uint8Array).length).toBe(32);
    expect(snap.context.sas).toBe('123456');
    expect(called.vmDHDone).toHaveBeenCalledTimes(1);

    // NEW: setRtcEndpoint + vmRtcDone
    expect(snap.context.rtcEndPoint).toBe(ep);
    expect(called.vmRtcDone).toHaveBeenCalledTimes(1);

    actor.stop();
  });

  it('happy path (join): auth → join → dh → rtc → cleanup → done', async () => {
    const seen: string[] = [];
    const called = {
      createRoom: vi.fn(),
      joinRoom: vi.fn(),
      vmRoomReady: vi.fn(),
      vmDHDone: vi.fn(),
      vmRtcDone: vi.fn(), // NEW
    };

    const roomMock: RoomRecord = {
      room_id: 'r2',
      owner: 'owner_uid',
      guestId: 'auth_uid',
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    const ep = dummyEp(); // NEW

    const fsm = roomInitFSM.provide({
      actors: {
        auth: fromPromise(async () => ({ authId: 'auth_uid' })),
        createRoom: fromPromise(
          async ({ input }: { input: { roomId: string; authId: string } }) => {
            called.createRoom(input);
            return { roomReady: true, room: roomMock };
          },
        ),
        joinRoom: fromPromise(async ({ input }: { input: { roomId: string; authId: string } }) => {
          called.joinRoom(input);
          return { roomReady: true, room: roomMock };
        }),
        dh: fromPromise(async () => ({ encKey: enc32(2), sas: '654321' })),
        rtc: fromPromise(async () => ({ rtcReady: true, endpoint: ep })), // NEW
        cleanup: fromPromise(async () => ({ cleanupDone: true })),
      },
      actions: {
        vmRoomReady: () => called.vmRoomReady(),
        vmDHDone: () => called.vmDHDone(),
        vmRtcDone: () => called.vmRtcDone(), // NEW
      },
    });

    const actor = createActor(fsm, { input: { roomId: 'r2', intent: 'join', secret: 's' } });
    const completion = new Promise<void>((resolve, reject) => {
      const sub = actor.subscribe((s) => {
        s.tags.forEach((t) => {
          seen.push(t);
        });
        if (s.status === 'done') {
          sub.unsubscribe();
          resolve();
        } else if (s.status === 'error') {
          sub.unsubscribe();
          reject(s.error ?? new Error('roomInitFSM actor failed'));
        }
      });
    });

    actor.start();
    await completion;

    const snap = actor.getSnapshot();
    expect(snap.status).toBe('done');
    expect(snap.context.authId).toBe('auth_uid');
    expect(seen).toEqual(expect.arrayContaining(['joining', 'dh', 'rtc', 'cleanup']));
    expect(called.joinRoom).toHaveBeenCalledWith({ roomId: 'r2', authId: 'auth_uid' });
    expect(called.createRoom).not.toHaveBeenCalled();
    expect(called.vmRoomReady).toHaveBeenCalledTimes(1);

    // setRoom
    expect(snap.context.room).toEqual(roomMock);

    // setDHResult
    expect(snap.context.encKey).toBeInstanceOf(Uint8Array);
    expect((snap.context.encKey as Uint8Array).length).toBe(32);
    expect(snap.context.sas).toBe('654321');
    expect(called.vmDHDone).toHaveBeenCalledTimes(1);

    // NEW: setRtcEndpoint + vmRtcDone
    expect(snap.context.rtcEndPoint).toBe(ep);
    expect(called.vmRtcDone).toHaveBeenCalledTimes(1);

    actor.stop();
  });
});
