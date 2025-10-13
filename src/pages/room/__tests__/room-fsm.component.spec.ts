import { describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { fromPromise } from 'xstate/actors';
import { roomInitFSM } from '../room-fsm';

describe('room-fsm component tests', () => {
  it('happy path: create → pake → sas → rtc → cleanup → done', async () => {
    const seen: string[] = [];
    const called = { createRoom: vi.fn() };

    const fsm = roomInitFSM.provide({
      actors: {
        auth: fromPromise(async () => ({ authId: 'auth_uid' })),
        createRoom: fromPromise(
          async ({ input }: { input: { roomId: string; authId: string } }) => {
            called.createRoom(input); // проверим, что пришёл правильный authId/roomId
            return { roomReady: true };
          },
        ),
        joinRoom: fromPromise(async () => ({ roomReady: true })), // не используется при intent=create
        pake: fromPromise(async () => ({ pakeKey: 'k' })),
        sas: fromPromise(async () => ({ sas: '123' })),
        rtc: fromPromise(async () => ({ rtcReady: true })),
        cleanup: fromPromise(async () => ({ cleanupDone: true })),
      },
    });

    const actor = createActor(fsm, { input: { roomId: 'r1', intent: 'create', secret: 's' } });

    const completion = new Promise<void>((resolve, reject) => {
      const subscription = actor.subscribe((snapshot) => {
        // фиксируем теги для проверки прохождения стадий
        for (const tag of snapshot.tags) seen.push(tag);

        if (snapshot.status === 'done') {
          subscription.unsubscribe();
          resolve();
        } else if (snapshot.status === 'error') {
          subscription.unsubscribe();
          reject(snapshot.error ?? new Error('roomInitFSM actor failed'));
        }
      });
    });

    actor.start();
    await completion;

    // 1) машина завершилась
    expect(actor.getSnapshot().status).toBe('done');

    // 2) контекст обновился через assign (authId из auth.onDone)
    expect(actor.getSnapshot().context.authId).toBe('auth_uid');

    // 3) ветка "create" реально пройдена
    expect(seen).toContain('creating'); // тег из состояния room.create

    // 4) пайплайн стадий пройден
    expect(seen).toEqual(expect.arrayContaining(['pake', 'sas', 'rtc', 'cleanup']));

    // 5) в createRoom попали корректные параметры
    expect(called.createRoom).toHaveBeenCalledWith({ roomId: 'r1', authId: 'auth_uid' });
  });
});
