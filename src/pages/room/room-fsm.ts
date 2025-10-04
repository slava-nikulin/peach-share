import { assign, createMachine, fromPromise, sendTo, setup, type ActorRefFrom } from "xstate";
import { delay } from "../../util/time";
import type { Intent } from "./types";

type Input = {
  roomId: string
  intent: Intent
  secret?: string
}

// События для view-model актора (простой редьюсер/transition)

export const roomInitFSM = setup({
  types: {} as {
    input: Input
    context: Input
  },
  // Встроенные шаги — асинхронная логика инкапсулирована в акторах
  actors: {
    auth: fromPromise(async () => {
      await delay(2000);
      console.log('auth')
      const authId = "123"
      return { authId }
    }),
    createRoom: fromPromise(async ({ input }: { input: Input }) => {
      console.log('create room')
      await delay(2000);
      return { roomReady: true }
    }),
    joinRoom: fromPromise(async ({ input }: { input: Input }) => {
      console.log('join room')
      await delay(2000);
      return { roomReady: true }
    }),
    pake: fromPromise(async ({ input }: { input: Input }) => {
      console.log('pake key')
      const key = "321"
      await delay(2000);
      return { pakeKey: key, pakeReady: true }
    }),
    sas: fromPromise(async () => {
      console.log('pake session(sas)')
      await delay(2000);
      const sas = "sas"
      return { sas }
    }),
    rtc: fromPromise(async () => {
      console.log('rtc')
      await delay(2000);
      return { rtcReady: true }
    }),
    cleanup: fromPromise(async () => {
      console.log('cleanup')
      await delay(2000);
      return { cleanupDone: true }
    }),
  },
  // Экшены объявляем, а реализацию подставим через provide с замыканием на vm
  actions: {
    vmAuthDone: () => { },
    vmRoomReady: () => { },
    vmPakeDone: () => { },
    vmSasDone: () => { },
    vmRtcDone: () => { },
    vmCleanupDone: () => { },
    captureError: () => { }
  },
}).createMachine({
  context: ({ input }) => input,
  id: 'room-fsm',
  initial: 'auth',
  states: {
    auth: {
      tags: ['auth'],
      invoke: {
        src: 'auth',
        onDone: { target: 'room', actions: 'vmAuthDone' },
        onError: { target: '#room-fsm.failed', actions: 'captureError' }
      },
    },
    room: {
      tags: ['room'],
      initial: 'decide',
      states: {
        decide: {
          always: [
            { guard: ({ context }) => context.intent === 'create', target: 'create' },
            { target: 'join' },
          ],
        },
        create: {
          tags: ['creating'],
          invoke: {
            src: 'createRoom',
            input: ({ context }) => context,
            onDone: { target: 'done', actions: 'vmRoomReady' },
            onError: { target: '#room-fsm.failed', actions: 'captureError' }
          },
        },
        join: {
          tags: ['joining'],
          invoke: {
            src: 'joinRoom',
            input: ({ context }) => context,
            onDone: { target: 'done', actions: 'vmRoomReady' },
            onError: { target: '#room-fsm.failed', actions: 'captureError' }
          },
        },
        done: { type: 'final' },
      },
      onDone: 'pake',
    },
    pake: {
      tags: ['pake'],
      invoke: {
        src: 'pake',
        input: ({ context }) => context,
        onDone: { target: 'sas', actions: 'vmPakeDone' },
        onError: { target: '#room-fsm.failed', actions: 'captureError' }
      },
    },
    sas: {
      tags: ['sas'],
      invoke: {
        src: 'sas',
        onDone: { target: 'rtc', actions: 'vmSasDone' },
        onError: { target: '#room-fsm.failed', actions: 'captureError' }
      },
    },
    rtc: {
      tags: ['rtc'],
      invoke: {
        src: 'rtc',
        onDone: { target: 'cleanup', actions: 'vmRtcDone' },
        onError: { target: '#room-fsm.failed', actions: 'captureError' }
      },
    },
    cleanup: {
      tags: ['cleanup'],
      invoke: {
        src: 'cleanup',
        onDone: { target: 'done', actions: 'vmCleanupDone' },
        onError: { target: '#room-fsm.failed', actions: 'captureError' }
      },
    },
    failed: {
      id: 'failed',
    },
    done: { type: 'final' },
  },
})

export type RoomInitActor = ActorRefFrom<typeof roomInitFSM>
