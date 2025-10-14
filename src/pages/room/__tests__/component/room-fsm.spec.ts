import { describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { fromPromise } from 'xstate/actors';
import type { RoomRecord } from '../../fsm-actors/type';
import { roomInitFSM } from '../../room-fsm';

describe('room-fsm component tests', () => {
  it('happy path (create): auth → create → pake → sas → rtc → cleanup → done', async () => {
    const seen: string[] = [];
    const called = {
      createRoom: vi.fn(),
      joinRoom: vi.fn(),
      vmRoomReady: vi.fn(),
    };

    const roomMock: RoomRecord = {
      room_id: 'r1',
      owner: 'auth_uid',
      created_at: Date.now(),
      updated_at: Date.now(),
    };

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
        pake: fromPromise(async () => ({ pakeKey: 'k' })),
        sas: fromPromise(async () => ({ sas: '123' })),
        rtc: fromPromise(async () => ({ rtcReady: true })),
        cleanup: fromPromise(async () => ({ cleanupDone: true })),
      },
      actions: {
        vmRoomReady: () => called.vmRoomReady(),
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

    expect(actor.getSnapshot().status).toBe('done');
    expect(actor.getSnapshot().context.authId).toBe('auth_uid');
    expect(seen).toContain('creating');
    expect(seen).toEqual(expect.arrayContaining(['pake', 'sas', 'rtc', 'cleanup']));
    expect(called.createRoom).toHaveBeenCalledWith({ roomId: 'r1', authId: 'auth_uid' });
    expect(called.joinRoom).not.toHaveBeenCalled();
    expect(called.vmRoomReady).toHaveBeenCalledTimes(1);

    // проверяем setRoom
    expect(actor.getSnapshot().context.room).toEqual(roomMock);
  });

  it('happy path (join): auth → join → pake → sas → rtc → cleanup → done', async () => {
    const seen: string[] = [];
    const called = {
      createRoom: vi.fn(),
      joinRoom: vi.fn(),
      vmRoomReady: vi.fn(),
    };

    const roomMock: RoomRecord = {
      room_id: 'r2',
      owner: 'owner_uid',
      guestId: 'auth_uid',
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    const fsm = roomInitFSM.provide({
      actors: {
        auth: fromPromise(async () => ({ authId: 'auth_uid' })),
        createRoom: fromPromise(async ({ input }) => {
          called.createRoom(input as { input: { roomId: string; authId: string } });
          return { roomReady: true, room: roomMock };
        }),
        joinRoom: fromPromise(async ({ input }: { input: { roomId: string; authId: string } }) => {
          called.joinRoom(input);
          return { roomReady: true, room: roomMock };
        }),
        pake: fromPromise(async () => ({ pakeKey: 'k' })),
        sas: fromPromise(async () => ({ sas: '123' })),
        rtc: fromPromise(async () => ({ rtcReady: true })),
        cleanup: fromPromise(async () => ({ cleanupDone: true })),
      },
      actions: { vmRoomReady: () => called.vmRoomReady() },
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

    expect(actor.getSnapshot().status).toBe('done');
    expect(actor.getSnapshot().context.authId).toBe('auth_uid');
    expect(seen).toContain('joining');
    expect(seen).toEqual(expect.arrayContaining(['pake', 'sas', 'rtc', 'cleanup']));
    expect(called.joinRoom).toHaveBeenCalledWith({ roomId: 'r2', authId: 'auth_uid' });
    expect(called.createRoom).not.toHaveBeenCalled();
    expect(called.vmRoomReady).toHaveBeenCalledTimes(1);

    // проверяем setRoom
    expect(actor.getSnapshot().context.room).toEqual(roomMock);
  });
});
