import {
  type ActorRefFrom,
  type AnyEventObject,
  type AnyStateMachine,
  assign,
  type DoneActorEvent,
  fromPromise,
  setup,
} from 'xstate';
import { delay } from '../../util/time';
import { anonAuth } from './fsm-actors/auth';
import { createRoom } from './fsm-actors/create-room';
import { joinRoom } from './fsm-actors/join-room';
import type { Intent, RoomRecord } from './types';

interface Input extends Record<string, unknown> {
  roomId: string;
  intent: Intent;
  secret: string;
}

interface Ctx extends Input {
  authId?: string;
  room?: RoomRecord;
}

const requireAuthId = (ctx: Ctx): string => {
  if (!ctx.authId) throw new Error('authId missing');
  return ctx.authId;
};

export const roomInitFSM: AnyStateMachine = setup({
  types: {} as {
    input: Input;
    context: Ctx;
  },
  actors: {
    auth: fromPromise(async () => {
      const authId = await anonAuth();
      return { authId };
    }),
    createRoom: fromPromise(async ({ input }: { input: { roomId: string; authId: string } }) => {
      const room = await createRoom(input);
      return { roomReady: true, room: room };
    }),
    joinRoom: fromPromise(async ({ input }: { input: { roomId: string; authId: string } }) => {
      const room = await joinRoom(input);
      return { roomReady: true, room: room };
    }),
    pake: fromPromise(async () => {
      console.log('pake key');
      const key = '321';
      await delay(2000);
      return { pakeKey: key };
    }),
    sas: fromPromise(async () => {
      console.log('pake session(sas)');
      await delay(2000);
      const sas = 'sas';
      return { sas };
    }),
    rtc: fromPromise(async () => {
      console.log('rtc');
      await delay(2000);
      return { rtcReady: true };
    }),
    cleanup: fromPromise(async () => {
      console.log('cleanup');
      await delay(2000);
      return { cleanupDone: true };
    }),
  },
  actions: {
    vmAuthDone: () => {},
    setAuthId: assign(({ event }: { context: Ctx; event: AnyEventObject }) => {
      const doneEvent = event as DoneActorEvent<{ authId?: string }>;

      const { output } = doneEvent;
      if (
        typeof output === 'object' &&
        output !== null &&
        'authId' in output &&
        typeof output.authId === 'string'
      ) {
        return { authId: output.authId };
      }
      return {};
    }),
    setRoom: assign(({ event }: { context: Ctx; event: AnyEventObject }) => {
      const doneEvent = event as DoneActorEvent<{ room?: RoomRecord }>;

      const { output } = doneEvent;
      if (
        typeof output === 'object' &&
        output !== null &&
        'room' in output &&
        typeof output.room === 'object' &&
        output.room !== null
      ) {
        return { room: doneEvent.output.room as RoomRecord };
      }
      return {};
    }),
    vmRoomReady: () => {},
    vmPakeDone: () => {},
    vmSasDone: () => {},
    vmRtcDone: () => {},
    vmCleanupDone: () => {},
    captureError: () => {},
  },
  guards: {
    isCreate: ({ context }: { context: Input }) => context.intent === 'create',
    isAuthed: ({ context }: { context: Ctx }) => !!context.authId,
  },
}).createMachine({
  context: ({ input }: { input: Input }): Ctx => ({ ...input }),
  id: 'room-fsm',
  initial: 'auth',
  states: {
    auth: {
      tags: ['auth'],
      invoke: {
        src: 'auth',
        onDone: {
          target: 'room',
          actions: ['vmAuthDone', 'setAuthId'],
        },
        onError: { target: '#room-fsm.failed', actions: 'captureError' },
      },
    },
    room: {
      tags: ['room'],
      initial: 'gate',
      states: {
        gate: {
          always: [{ guard: 'isAuthed', target: 'decide' }, { target: '#room-fsm.failed' }],
        },
        decide: {
          always: [{ guard: 'isCreate', target: 'create' }, { target: 'join' }],
        },
        create: {
          tags: ['creating'],
          invoke: {
            src: 'createRoom',
            input: ({ context }: { context: Ctx }): { roomId: string; authId: string } => ({
              roomId: context.roomId,
              authId: requireAuthId(context),
            }),
            onDone: { target: 'done', actions: ['vmRoomReady', 'setRoom'] },
            onError: { target: '#room-fsm.failed', actions: 'captureError' },
          },
        },
        join: {
          tags: ['joining'],
          invoke: {
            src: 'joinRoom',
            input: ({ context }: { context: Ctx }): { roomId: string; authId: string } => ({
              roomId: context.roomId,
              authId: requireAuthId(context),
            }),
            onDone: { target: 'done', actions: ['vmRoomReady', 'setRoom'] },
            onError: { target: '#room-fsm.failed', actions: 'captureError' },
          },
        },

        done: { type: 'final' },
      },
      // Дальше по пайплайну (pake/sas/rtc) по желанию
      onDone: 'pake',
    },
    pake: {
      tags: ['pake'],
      invoke: {
        src: 'pake',
        input: ({ context }: { context: Input }) => context,
        onDone: { target: 'sas', actions: 'vmPakeDone' },
        onError: { target: '#room-fsm.failed', actions: 'captureError' },
      },
    },
    sas: {
      tags: ['sas'],
      invoke: {
        src: 'sas',
        onDone: { target: 'rtc', actions: 'vmSasDone' },
        onError: { target: '#room-fsm.failed', actions: 'captureError' },
      },
    },
    rtc: {
      tags: ['rtc'],
      invoke: {
        src: 'rtc',
        onDone: { target: 'cleanup', actions: 'vmRtcDone' },
        onError: { target: '#room-fsm.failed', actions: 'captureError' },
      },
    },
    cleanup: {
      tags: ['cleanup'],
      invoke: {
        src: 'cleanup',
        onDone: { target: 'done', actions: 'vmCleanupDone' },
        onError: { target: '#room-fsm.failed', actions: 'captureError' },
      },
    },
    failed: {
      id: 'failed',
    },
    done: { type: 'final' },
  },
});

export type RoomInitActor = ActorRefFrom<typeof roomInitFSM>;
