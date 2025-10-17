import {
  type ActorRefFrom,
  type AnyEventObject,
  type AnyStateMachine,
  assign,
  type DoneActorEvent,
  fromPromise,
  setup,
} from 'xstate';
import type { RtcEndpoint } from '../../lib/webrtc';
import { delay } from '../../util/time';
import { getIceServers } from './config/ice';
import { anonAuth } from './fsm-actors/auth';
import { createRoom } from './fsm-actors/create-room';
import { startDH } from './fsm-actors/dh';
import { joinRoom } from './fsm-actors/join-room';
import { startRTC } from './fsm-actors/rtc';
import type { Intent, RoomRecord } from './types';

interface Input extends Record<string, unknown> {
  roomId: string;
  intent: Intent;
  secret: string;
}

interface Ctx extends Input {
  authId?: string;
  room?: RoomRecord;
  encKey?: Uint8Array;
  sas?: string;
  rtcEndPoint?: RtcEndpoint;
  lastError?: { at: string; message: string; cause?: unknown };
}

// helpers
// const toErr = (value: unknown): unknown => {
//   if (typeof value === 'object' && value !== null) {
//     const candidate = value as { error?: unknown; data?: unknown };
//     if (candidate.error !== undefined) return candidate.error;
//     if (candidate.data !== undefined) return candidate.data;
//   }
//   return value;
// };
// const msgOf = (value: unknown): string => {
//   if (typeof value === 'object' && value !== null) {
//     const candidate = value as { message?: unknown; toString?: () => string };
//     if (typeof candidate.message === 'string') return candidate.message;
//     if (typeof candidate.toString === 'function') return candidate.toString();
//   }
//   return String(value);
// };

const requireAuthId = (ctx: Ctx): string => {
  if (!ctx.authId) throw new Error('authId missing');
  return ctx.authId;
};

const requireRoom = (ctx: Ctx): RoomRecord => {
  if (!ctx.room) throw new Error('room missing');
  return ctx.room;
};

const requireEncKey = (ctx: Ctx): Uint8Array => {
  if (!ctx.encKey) throw new Error('encKey missing');
  return ctx.encKey;
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
    dh: fromPromise(
      async ({ input }: { input: { room: RoomRecord; intent: Intent; secret: string } }) => {
        const role = input.intent === 'create' ? 'owner' : 'guest';
        const { enc_key, sas } = await startDH({
          roomId: input.room.room_id,
          role,
          sharedS: input.secret,
          timeoutMs: 120_000,
          sasDigits: undefined,
          context: undefined,
        });
        return { encKey: enc_key, sas };
      },
    ),
    rtc: fromPromise(
      async ({ input }: { input: { room: RoomRecord; intent: Intent; encKey: Uint8Array } }) => {
        const { endpoint } = await startRTC({
          room: input.room,
          intent: input.intent,
          encKey: input.encKey,
          timeoutMs: 120_000,
          stun: getIceServers(),
        });
        return { rtcReady: true, endpoint };
      },
    ),
    cleanup: fromPromise(async () => {
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
    setDHResult: assign(({ event }: { context: Ctx; event: AnyEventObject }) => {
      const doneEvent = event as DoneActorEvent<{ encKey?: Uint8Array; sas?: string }>;

      const { output } = doneEvent;
      if (
        typeof output === 'object' &&
        output !== null &&
        'encKey' in output &&
        typeof output.encKey === 'object' &&
        output.encKey !== null
      ) {
        return { encKey: doneEvent.output.encKey as Uint8Array, sas: doneEvent.output.sas };
      }
      return {};
    }),
    setRtcEndpoint: assign(({ event }: { context: Ctx; event: AnyEventObject }) => {
      const doneEvent = event as DoneActorEvent<{ endpoint?: RtcEndpoint }>;

      const { output } = doneEvent;
      if (
        typeof output === 'object' &&
        output !== null &&
        'endpoint' in output &&
        typeof output.endpoint === 'object' &&
        output.endpoint !== null
      ) {
        return { rtcEndPoint: doneEvent.output.endpoint as RtcEndpoint };
      }
      return {};
    }),
    vmRoomReady: () => {},
    vmDHDone: () => {},
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
      onDone: 'dh',
    },
    dh: {
      tags: ['dh'],
      invoke: {
        src: 'dh',
        input: ({
          context,
        }: {
          context: Ctx;
        }): { room: RoomRecord; intent: Intent; secret: string } => ({
          intent: context.intent,
          room: requireRoom(context),
          secret: context.secret,
        }),
        onDone: { target: 'rtc', actions: ['vmDHDone', 'setDHResult'] },
        onError: { target: '#room-fsm.failed', actions: 'captureError' },
      },
    },
    rtc: {
      tags: ['rtc'],
      invoke: {
        src: 'rtc',
        input: ({
          context,
        }: {
          context: Ctx;
        }): { room: RoomRecord; intent: Intent; encKey: Uint8Array } => ({
          intent: context.intent,
          room: requireRoom(context),
          encKey: requireEncKey(context),
        }),
        onDone: { target: 'cleanup', actions: ['vmRtcDone', 'setRtcEndpoint'] },
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
