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
import { ensureAnon } from './config/firebase';
import { createRoom } from './fsm-actors/create-room';
import type { Intent } from './types';

interface Input extends Record<string, unknown> {
  roomId: string;
  intent: Intent;
  secret: string;
}

interface Ctx extends Input {
  authId?: string;
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
      const authId = await ensureAnon();
      return { authId };
    }),
    createRoom: fromPromise(async ({ input }: { input: { roomId: string; authId: string } }) => {
      await createRoom(input);
      return { roomReady: true };
    }),
    joinRoom: fromPromise(async () => {
      console.log('join room');
      await delay(2000);
      return { roomReady: true };
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
    setAuthId: assign(({ context, event }: { context: Ctx; event: AnyEventObject }) => {
      const doneEvent = event as DoneActorEvent<{ authId?: string }>;
      const authIdFromEvent =
        typeof doneEvent.output === 'object' ? doneEvent.output?.authId : undefined;
      if (typeof authIdFromEvent === 'string') {
        return { authId: authIdFromEvent };
      }

      return { authId: context.authId };
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
            onDone: { target: 'done', actions: 'vmRoomReady' },
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
            onDone: { target: 'done', actions: 'vmRoomReady' },
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
