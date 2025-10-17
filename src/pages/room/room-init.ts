import { createActor, type DoneActorEvent, type ErrorActorEvent } from 'xstate';
import { type RoomInitActor, roomInitFSM } from './room-fsm';
import { createRoomVM, type Intent, type RoomVM } from './types';

interface StartRoomFlowResult {
  actor: RoomInitActor;
  vm: RoomVM;
  stop: () => void;
}

export function startRoomFlow(
  input: { roomId: string; intent: Intent; secret: string },
  setError?: (msg: string | null) => void,
): StartRoomFlowResult {
  const vm = createRoomVM();

  vm.setSecret(input.secret);

  const machineWithVM = roomInitFSM.provide({
    actions: {
      vmAuthDone: ({ event }: { event: DoneActorEvent<{ authId: string }> }) => {
        vm.setAuthId(event.output.authId);
      },
      vmRoomReady: () => vm.setRoomCreated(true),
      vmDHDone: ({ event }: { event: DoneActorEvent<{ encKey: string; sas: string }> }) => {
        vm.setSas(event.output.sas);
      },
      vmRtcDone: () => vm.setRtcReady(true),
      vmCleanupDone: () => vm.setCleanupDone(true),
      captureError: ({ event }: { event: ErrorActorEvent }) => {
        const toLog =
          event.error instanceof Error
            ? (event.error.stack ?? `${event.error.name}: ${event.error.message}`)
            : event.error;
        console.error('[FSM ERROR]', toLog);
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
