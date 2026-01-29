import { type JSX, onCleanup, onMount, Show } from 'solid-js';
import { toFileBus } from '../../../lib/file-bus';
import type { RtcEndpoint } from '../../../lib/webrtc';
import { DropOverlay, Dropzone, PeerHeaderSimple } from './room-files/DropZone';
import { createDragOverlayController } from './room-files/drag-overlay';
import { FileTransfer } from './room-files/file-transfer';
import { GuestList } from './room-files/GuestFileList';
import { MyFileList } from './room-files/MyFileList';
import {
  createControlMessageHandler,
  createLocalFilesState,
  createRemoteFilesState,
  setupConnectionGuards,
} from './room-files/state';

function useRoomFilesLifecycle(args: {
  endpoint: RtcEndpoint;
  onDisconnect?: (reason: string) => void;
  onSync: () => void;
  attachGuards: () => (() => void) | undefined;
  teardown: () => void;
}): void {
  let unloadHandler: (() => void) | undefined;
  let guards: (() => void) | undefined;

  onMount(() => {
    unloadHandler = (): void => {
      try {
        args.endpoint.close();
      } catch {}
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', unloadHandler);
      window.addEventListener('pagehide', unloadHandler);
    }

    guards = args.attachGuards();
    args.onSync();
  });

  onCleanup(() => {
    if (typeof window !== 'undefined' && unloadHandler) {
      window.removeEventListener('beforeunload', unloadHandler);
      window.removeEventListener('pagehide', unloadHandler);
    }
    guards?.();
    args.teardown();
    try {
      args.endpoint.close();
    } catch {}
  });
}

export function RoomFiles(props: {
  ep: RtcEndpoint;
  onDisconnect?: (reason: string) => void;
}): JSX.Element {
  const bus = toFileBus(props.ep);
  const transfer = new FileTransfer(props.ep, bus);
  const local = createLocalFilesState(bus);
  const remote = createRemoteFilesState(bus, transfer);
  const requestRemoteFile = remote.requestFile.bind(remote);
  const handleControlMessage = createControlMessageHandler(local, remote, transfer);

  const {
    isDragActive,
    onInputChange,
    handleRootDragOver,
    handleFileDrop,
    cleanup: cleanupDragState,
  } = createDragOverlayController(local.addFiles);

  const offJSON = bus.onJSON(handleControlMessage);
  const offBin = bus.onBinary(() => {
    /* reserved for future binary control */
  });

  const teardown = (): void => {
    offJSON();
    offBin();
    remote.cleanup();
    cleanupDragState();
    transfer.dispose();
  };

  useRoomFilesLifecycle({
    endpoint: props.ep,
    onDisconnect: props.onDisconnect,
    onSync: () => local.syncWithPeer(),
    attachGuards: () => setupConnectionGuards(props.ep, props.onDisconnect),
    teardown,
  });

  return (
    <div
      class="relative space-y-4"
      role="application"
      aria-label="File sharing workspace"
      tabIndex={-1}
    >
      <Show when={isDragActive()}>
        <DropOverlay />
      </Show>

      <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Dropzone
          onInputChange={onInputChange}
          onDrop={handleFileDrop}
          onDragOver={handleRootDragOver}
        />
        <div class="flex flex-col rounded-2xl border border-white/70 bg-white/70 shadow-sm md:col-span-2">
          <PeerHeaderSimple label="You" count={local.files().length} you />
          <MyFileList files={local.files()} onRemove={local.removeFile} />
        </div>
      </div>

      <div class="flex flex-col rounded-2xl border border-white/70 bg-white/70 shadow-sm">
        <PeerHeaderSimple label="Guest" count={remote.files().length} />
        <GuestList files={remote.files()} onRequest={requestRemoteFile} />
      </div>
    </div>
  );
}
