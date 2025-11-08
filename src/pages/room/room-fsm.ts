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
import { cleanUp } from './fsm-actors/cleanup';
import { createRoom } from './fsm-actors/create-room';
import { startDH } from './fsm-actors/dh';
import { fsmFail } from './fsm-actors/fail';
import { joinRoom } from './fsm-actors/join-room';
import { startRTC } from './fsm-actors/rtc';
import { getIceServers } from './lib/ice';
import type { RtdbConnector } from './lib/RtdbConnector';
import type { Intent, RoomRecord } from './types';

interface Input extends Record<string, unknown> {
  roomId: string;
  intent: Intent;
  secret: string;
  authId: string;
  rtdb: RtdbConnector;
}

interface Ctx extends Input {
  room?: RoomRecord;
  encKey?: Uint8Array;
  sas?: string;
  rtcEndPoint?: RtcEndpoint;
  lastError?: { at: string; message: string; cause?: unknown };
}

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
    createRoom: fromPromise(
      async ({ input }: { input: { roomId: string; authId: string; rtdb: RtdbConnector } }) => {
        const room = await createRoom(input);
        return { roomReady: true, room: room };
      },
    ),
    joinRoom: fromPromise(
      async ({ input }: { input: { roomId: string; authId: string; rtdb: RtdbConnector } }) => {
        const room = await joinRoom(input);
        return { roomReady: true, room: room };
      },
    ),
    dh: fromPromise(
      async ({
        input,
      }: {
        input: { room: RoomRecord; intent: Intent; secret: string; rtdb: RtdbConnector };
      }) => {
        const role = input.intent === 'create' ? 'owner' : 'guest';
        const { enc_key, sas } = await startDH({
          roomId: input.room.room_id,
          role,
          sharedS: input.secret,
          timeoutMs: 120_000,
          sasDigits: undefined,
          context: undefined,
          rtdb: input.rtdb,
        });
        return { encKey: enc_key, sas };
      },
    ),
    rtc: fromPromise(
      async ({
        input,
        signal,
      }: {
        input: { room: RoomRecord; intent: Intent; encKey: Uint8Array; rtdb: RtdbConnector };
        signal?: AbortSignal;
      }) => {
        const { endpoint } = await startRTC({
          room: input.room,
          intent: input.intent,
          encKey: input.encKey,
          timeoutMs: 120_000,
          stun: getIceServers(),
          abortSignal: signal,
          rtdb: input.rtdb,
        });
        return { rtcReady: true, endpoint };
      },
    ),
    failed: fromPromise(
      async ({
        input,
      }: {
        input: { room?: RoomRecord; rtdb: RtdbConnector };
      }): Promise<{ cleanupDone: true }> => {
        if (input.room) {
          await fsmFail(input.rtdb, input.room.room_id);
        }
        input.rtdb.cleanup();
        return { cleanupDone: true };
      },
    ),
    cleanup: fromPromise(
      async ({
        input,
      }: {
        input: { roomId: string; rtdb: RtdbConnector };
      }): Promise<{ cleanupDone: true }> => {
        await cleanUp(input.rtdb, input.roomId);
        return { cleanupDone: true };
      },
    ),
  },
  actions: {
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
  },
}).createMachine({
  context: ({ input }: { input: Input }): Ctx => ({ ...input }),
  id: 'room-fsm',
  initial: 'room',
  states: {
    room: {
      tags: ['room'],
      initial: 'gate',
      states: {
        gate: {
          always: [{ target: 'decide' }],
        },
        decide: {
          always: [{ guard: 'isCreate', target: 'create' }, { target: 'join' }],
        },
        create: {
          tags: ['creating'],
          invoke: {
            src: 'createRoom',
            input: ({
              context,
            }: {
              context: Ctx;
            }): { roomId: string; authId: string; rtdb: RtdbConnector } => ({
              roomId: context.roomId,
              authId: requireAuthId(context),
              rtdb: context.rtdb,
            }),
            onDone: { target: 'done', actions: ['vmRoomReady', 'setRoom'] },
            onError: {
              target: '#room-fsm.failed',
              actions: ['captureError'],
            },
          },
        },
        join: {
          tags: ['joining'],
          invoke: {
            src: 'joinRoom',
            input: ({
              context,
            }: {
              context: Ctx;
            }): { roomId: string; authId: string; rtdb: RtdbConnector } => ({
              roomId: context.roomId,
              authId: requireAuthId(context),
              rtdb: context.rtdb,
            }),
            onDone: { target: 'done', actions: ['vmRoomReady', 'setRoom'] },
            onError: {
              target: '#room-fsm.failed',
              actions: ['captureError'],
            },
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
        }): { room: RoomRecord; intent: Intent; secret: string; rtdb: RtdbConnector } => ({
          intent: context.intent,
          room: requireRoom(context),
          secret: context.secret,
          rtdb: context.rtdb,
        }),
        onDone: { target: 'rtc', actions: ['vmDHDone', 'setDHResult'] },
        onError: {
          target: '#room-fsm.failed',
          actions: ['captureError'],
        },
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
        }): { room: RoomRecord; intent: Intent; encKey: Uint8Array; rtdb: RtdbConnector } => ({
          intent: context.intent,
          room: requireRoom(context),
          encKey: requireEncKey(context),
          rtdb: context.rtdb,
        }),
        onDone: { target: 'cleanup', actions: ['vmRtcDone', 'setRtcEndpoint'] },
        onError: {
          target: '#room-fsm.failed',
          actions: ['captureError'],
        },
      },
    },
    cleanup: {
      tags: ['cleanup'],
      invoke: {
        src: 'cleanup',
        input: ({ context }: { context: Ctx }): { rtdb: RtdbConnector; roomId: string } => ({
          roomId: context.roomId,
          rtdb: context.rtdb,
        }),
        onDone: { target: 'done', actions: 'vmCleanupDone' },
        onError: {
          target: '#room-fsm.failed',
          actions: ['captureError'],
        },
      },
    },
    failed: {
      id: 'failed',
      tags: ['failed'],
      invoke: {
        src: 'failed',
        input: ({ context }: { context: Ctx }): { room?: RoomRecord; rtdb: RtdbConnector } => ({
          room: context.room,
          rtdb: context.rtdb,
        }),
        onDone: { target: 'done' },
        onError: {
          target: '#room-fsm.done',
          actions: ['captureError'],
        },
      },
    },
    done: { type: 'final' },
  },
});

export type RoomInitActor = ActorRefFrom<typeof roomInitFSM>;
