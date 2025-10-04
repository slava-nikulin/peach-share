import { createActor } from "xstate";
import { createRoomVM, type Intent } from "./types";
import { roomInitFSM } from "./room-fsm";

export function startRoomFlow(
  input: { roomId: string; intent: Intent; secret?: string },
  setError?: (msg: string | null) => void
) {
  const vm = createRoomVM()
  vm.setRoomId(input.roomId)

  const machineWithVM = roomInitFSM.provide({
    actions: {
      vmAuthDone: ({ event }) => {
        const id = (event as any).output.authId as string
        vm.setAuthId(id)
      },
      vmRoomReady: () => vm.setRoomCreated(true),
      vmPakeDone: ({ event }) => {
        const { pakeKey } = (event as any).output
        vm.setPakeKey(pakeKey)
      },
      vmSasDone: ({ event }) => vm.setSas((event as any).output.sas),
      vmRtcDone: () => vm.setRtcReady(true),
      vmCleanupDone: () => vm.setCleanupDone(true),
      captureError: ({ event }) => {
        setError?.(normalizeError((event as any).error))
      },
    },
  })

  const actor = createActor(machineWithVM, { input })
  actor.start()

  actor.subscribe({
    error: (err) => setError?.(normalizeError(err)), // на случай если забыли прописать onError в state
  })

  return {
    actor, vm, stop: () => {
      actor.stop()
    }
  }
}

function normalizeError(e: unknown): string {
  if (e instanceof Error) return e.message
  try { return JSON.stringify(e) } catch { return String(e) }
}