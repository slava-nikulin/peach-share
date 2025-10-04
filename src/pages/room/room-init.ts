import { createActor, type DoneActorEvent, type ErrorActorEvent } from 'xstate';
import { type RoomInitActor, roomInitFSM } from './room-fsm';
import { createRoomVM, type Intent, type RoomVM } from './types';

interface StartRoomFlowResult {
  actor: RoomInitActor;
  vm: RoomVM;
  stop: () => void;
}

export function startRoomFlow(
  input: { roomId: string; intent: Intent; secret?: string },
  setError?: (msg: string | null) => void,
): StartRoomFlowResult {
  const vm = createRoomVM();

  vm.setRoomId(input.roomId);

  const machineWithVM = roomInitFSM.provide({
    actions: {
      vmAuthDone: ({ event }: { event: DoneActorEvent<{ authId: string }> }) => {
        vm.setAuthId(event.output.authId);
      },
      vmRoomReady: () => vm.setRoomCreated(true),
      vmPakeDone: ({ event }: { event: DoneActorEvent<{ pakeKey: string }> }) => {
        vm.setPakeKey(event.output.pakeKey);
      },
      vmSasDone: ({ event }: { event: DoneActorEvent<{ sas: string }> }) => {
        vm.setSas(event.output.sas);
      },
      vmRtcDone: () => vm.setRtcReady(true),
      vmCleanupDone: () => vm.setCleanupDone(true),
      captureError: ({ event }: { event: ErrorActorEvent }) => {
        setError?.(normalizeError(event.error));
      },
    },
  });

  const actor = createActor(machineWithVM, { input });
  actor.start();

  actor.subscribe({
    error: (err: unknown) => setError?.(normalizeError(err)), // на случай если забыли прописать onError в state
  });

  return {
    actor,
    vm,
    stop: (): void => {
      actor.stop();
    },
  };
}

function normalizeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
