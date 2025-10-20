import { type JSX, onCleanup, onMount, Show } from 'solid-js';
import { toFileBus } from '../../../lib/file-bus';
import type { RtcEndpoint } from '../../../lib/webrtc';
import { DropOverlay, Dropzone, PeerHeaderSimple } from './room-files/DropZone';
import { createDragOverlayController } from './room-files/drag-overlay';
import { GuestList } from './room-files/GuestFileList';
import { MyFileList } from './room-files/MyFileList';
import {
  createChunkSender,
  createControlMessageHandler,
  createLocalFilesState,
  createRemoteFilesState,
  setupConnectionGuards,
} from './room-files/state';

export function RoomFiles(props: {
  ep: RtcEndpoint;
  onDisconnect?: (reason: string) => void;
}): JSX.Element {
  const bus = toFileBus(props.ep);
  const local = createLocalFilesState(bus);
  const remote = createRemoteFilesState(bus);
  const sendChunks = createChunkSender(props.ep, bus);
  const handleControlMessage = createControlMessageHandler(local, remote, sendChunks);

  const {
    isDragActive,
    onInputChange,
    handleRootDragOver,
    handleFileDrop,
    cleanup: cleanupDragState,
  } = createDragOverlayController(local.addFiles);

  const offJSON = bus.onJSON(handleControlMessage);
  const offBin = bus.onBinary(() => {
    /* no-op */
  });

  let teardownGuards: (() => void) | undefined;

  onMount(() => {
    teardownGuards = setupConnectionGuards(props.ep, props.onDisconnect);
    local.syncWithPeer();
  });

  onCleanup(() => {
    offJSON();
    offBin();
    teardownGuards?.();
    remote.cleanup();
    cleanupDragState();
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
        <GuestList files={remote.files()} onRequest={remote.requestFile} />
      </div>
    </div>
  );
}
