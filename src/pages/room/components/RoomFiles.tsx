import {
  type Accessor,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  type Setter,
  Show,
} from 'solid-js';
import { fromBase64Url, toBase64Url } from '../../../lib/crypto';
import { type FileBus, toFileBus } from '../../../lib/file-bus';
import type { RtcEndpoint } from '../../../lib/webrtc';

interface FileMeta {
  id: string;
  name: string;
  size: number;
  addedAt: number;
}
type RemoteMeta = FileMeta & { downloading?: boolean; url?: string };

interface MsgAnnounce {
  type: 'announce';
  file: FileMeta;
}
interface MsgRemove {
  type: 'remove';
  id: string;
}
interface MsgRequest {
  type: 'request';
  id: string;
}
interface MsgChunk {
  type: 'chunk';
  id: string;
  seq: number;
  last: boolean;
  b64: string;
}
interface MsgSync {
  type: 'sync';
  files: FileMeta[];
}
type CtrlMsg = MsgAnnounce | MsgRemove | MsgRequest | MsgChunk | MsgSync;

const MAX_FILE_SIZE: number = 200 * 1024 * 1024; // 200MB
const CHUNK_SIZE: number = 64 * 1024; // 64KB полезной нагрузки

interface LocalFilesState {
  files: Accessor<FileMeta[]>;
  addFiles: (files: FileList | File[]) => Promise<void>;
  removeFile: (id: string) => void;
  fileById: (id: string) => File | undefined;
  syncWithPeer: () => void;
}

interface RemoteFilesState {
  files: Accessor<RemoteMeta[]>;
  requestFile: (id: string) => void;
  handleSync: (files: FileMeta[]) => void;
  handleAnnounce: (file: FileMeta) => void;
  handleRemove: (id: string) => void;
  handleChunk: (chunk: MsgChunk) => void;
  cleanup: () => void;
}

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function fmtSize(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let size = n;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(1)} ${units[idx]}`;
}

export function RoomFiles(props: {
  ep: RtcEndpoint;
  onDisconnect?: (reason: string) => void;
}): JSX.Element {
  const bus = toFileBus(props.ep);
  const local = createLocalFilesState(bus);
  const remote = createRemoteFilesState(bus);
  const sendChunks = createChunkSender(props.ep, bus);
  const handleControlMessage = createControlMessageHandler(local, remote, sendChunks);

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
  });

  const onInputChange = (event: Event): void => {
    const target = event.target as HTMLInputElement;
    if (target.files) void local.addFiles(target.files);
    target.value = '';
  };

  const onDrop = (event: DragEvent): void => {
    event.preventDefault();
    const files = event.dataTransfer?.files;
    if (files?.length) void local.addFiles(files);
  };

  const onDragOver = (event: DragEvent): void => {
    event.preventDefault();
  };

  return (
    <div class="space-y-4">
      {/* Владелец */}
      <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Dropzone onInputChange={onInputChange} onDrop={onDrop} onDragOver={onDragOver} />
        <div class="flex flex-col rounded-2xl border border-white/70 bg-white/70 shadow-sm md:col-span-2">
          <PeerHeaderSimple label="You" count={local.files().length} you />
          <MyFileList files={local.files()} onRemove={local.removeFile} />
        </div>
      </div>

      {/* Гость */}
      <div class="flex flex-col rounded-2xl border border-white/70 bg-white/70 shadow-sm">
        <PeerHeaderSimple label="Guest" count={remote.files().length} />
        <GuestList files={remote.files()} onRequest={remote.requestFile} />
      </div>
    </div>
  );
}

function createLocalFilesState(bus: FileBus): LocalFilesState {
  const [files, setFiles] = createSignal<FileMeta[]>([]);
  const fileStore = new Map<string, File>();

  const addFiles = async (input: FileList | File[]): Promise<void> => {
    const candidates = Array.from(input).filter((file) => file.size <= MAX_FILE_SIZE);
    if (candidates.length === 0) return;

    const metas = candidates.map((file) => ({
      id: uid(),
      name: file.name,
      size: file.size,
      addedAt: Date.now(),
    }));

    metas.forEach((meta, index) => {
      fileStore.set(meta.id, candidates[index]);
    });
    setFiles((prev) => [...prev, ...metas]);
    metas.forEach((meta) => {
      bus.sendJSON({ type: 'announce', file: meta } satisfies MsgAnnounce);
    });
  };

  const removeFile = (id: string): void => {
    setFiles((prev) => prev.filter((file) => file.id !== id));
    fileStore.delete(id);
    bus.sendJSON({ type: 'remove', id } satisfies MsgRemove);
  };

  const fileById = (id: string): File | undefined => fileStore.get(id);

  const syncWithPeer = (): void => {
    bus.sendJSON({ type: 'sync', files: files() } satisfies MsgSync);
  };

  return { files, addFiles, removeFile, fileById, syncWithPeer };
}

interface ReceiveBufferEntry {
  chunks: BlobPart[];
  nextSeq: number;
}

interface ReceiveBufferRegistry {
  ensure(id: string): ReceiveBufferEntry;
  delete(id: string): void;
  deleteMissing(keepIds: Set<string>): void;
  clear(): void;
}

function createReceiveBufferRegistry(): ReceiveBufferRegistry {
  const buffers = new Map<string, ReceiveBufferEntry>();
  return {
    ensure(id: string): ReceiveBufferEntry {
      let entry = buffers.get(id);
      if (!entry) {
        entry = { chunks: [], nextSeq: 0 };
        buffers.set(id, entry);
      }
      return entry;
    },
    delete(id: string): void {
      buffers.delete(id);
    },
    deleteMissing(keepIds: Set<string>): void {
      for (const id of Array.from(buffers.keys())) {
        if (!keepIds.has(id)) buffers.delete(id);
      }
    },
    clear(): void {
      buffers.clear();
    },
  };
}

function revokeRemoteUrl(files: Accessor<RemoteMeta[]>, id: string): void {
  const record = files().find((file) => file.id === id);
  if (record?.url) URL.revokeObjectURL(record.url);
}

function revokeMissingUrls(files: Accessor<RemoteMeta[]>, keepIds: Set<string>): void {
  files().forEach((file) => {
    if (!keepIds.has(file.id) && file.url) URL.revokeObjectURL(file.url);
  });
}

function cleanupRemoteUrls(files: Accessor<RemoteMeta[]>): void {
  files().forEach((file) => {
    if (file.url) URL.revokeObjectURL(file.url);
  });
}

function createRemoteSyncHandler(
  files: Accessor<RemoteMeta[]>,
  setFiles: Setter<RemoteMeta[]>,
  buffers: ReceiveBufferRegistry,
): (list: FileMeta[]) => void {
  return (list: FileMeta[]) => {
    const keepIds = new Set(list.map((file) => file.id));
    revokeMissingUrls(files, keepIds);
    setFiles(list.map((file) => ({ ...file, downloading: false })));
    buffers.deleteMissing(keepIds);
  };
}

function createRemoteAnnounceHandler(setFiles: Setter<RemoteMeta[]>): (file: FileMeta) => void {
  return (file: FileMeta) => {
    setFiles((prev) => {
      if (prev.some((existing) => existing.id === file.id)) return prev;
      return [...prev, { ...file }];
    });
  };
}

function createRemoteRemoveHandler(
  files: Accessor<RemoteMeta[]>,
  setFiles: Setter<RemoteMeta[]>,
  buffers: ReceiveBufferRegistry,
): (id: string) => void {
  return (id: string) => {
    revokeRemoteUrl(files, id);
    buffers.delete(id);
    setFiles((prev) => prev.filter((file) => file.id !== id));
  };
}

function createRemoteChunkHandler(
  files: Accessor<RemoteMeta[]>,
  setFiles: Setter<RemoteMeta[]>,
  buffers: ReceiveBufferRegistry,
): (chunk: MsgChunk) => void {
  return (chunk: MsgChunk) => {
    const entry = buffers.ensure(chunk.id);
    if (chunk.seq !== entry.nextSeq) return;

    const payload = chunk.b64 ? fromBase64Url(chunk.b64) : new Uint8Array();
    if (payload.byteLength > 0) entry.chunks.push(payload.slice().buffer);
    entry.nextSeq += 1;

    if (chunk.last) {
      revokeRemoteUrl(files, chunk.id);
      const blob = new Blob(entry.chunks, { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      buffers.delete(chunk.id);
      setFiles((prev) =>
        prev.map((file) => (file.id === chunk.id ? { ...file, url, downloading: false } : file)),
      );
    }
  };
}

function createRemoteRequestHandler(
  bus: FileBus,
  setFiles: Setter<RemoteMeta[]>,
): (id: string) => void {
  return (id: string) => {
    setFiles((prev) =>
      prev.map((file) => (file.id === id ? { ...file, downloading: true, url: file.url } : file)),
    );
    bus.sendJSON({ type: 'request', id } satisfies MsgRequest);
  };
}

function createRemoteCleanup(
  files: Accessor<RemoteMeta[]>,
  buffers: ReceiveBufferRegistry,
  setFiles: Setter<RemoteMeta[]>,
): () => void {
  return () => {
    cleanupRemoteUrls(files);
    buffers.clear();
    setFiles([]);
  };
}

function createRemoteFilesState(bus: FileBus): RemoteFilesState {
  const [files, setFiles] = createSignal<RemoteMeta[]>([]);
  const buffers = createReceiveBufferRegistry();

  const handleSync = createRemoteSyncHandler(files, setFiles, buffers);
  const handleAnnounce = createRemoteAnnounceHandler(setFiles);
  const handleRemove = createRemoteRemoveHandler(files, setFiles, buffers);
  const handleChunk = createRemoteChunkHandler(files, setFiles, buffers);
  const requestFile = createRemoteRequestHandler(bus, setFiles);
  const cleanup = createRemoteCleanup(files, buffers, setFiles);

  return { files, requestFile, handleSync, handleAnnounce, handleRemove, handleChunk, cleanup };
}

function createControlMessageHandler(
  local: LocalFilesState,
  remote: RemoteFilesState,
  sendChunks: (id: string, file: File) => Promise<void>,
): (msg: unknown) => void {
  return (raw: unknown) => {
    const msg = raw as Partial<CtrlMsg> & { type?: string };
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'sync':
        remote.handleSync((msg as MsgSync).files);
        break;
      case 'announce':
        remote.handleAnnounce((msg as MsgAnnounce).file);
        break;
      case 'remove':
        remote.handleRemove((msg as MsgRemove).id);
        break;
      case 'chunk':
        remote.handleChunk(msg as MsgChunk);
        break;
      case 'request': {
        const { id } = msg as MsgRequest;
        const file = local.fileById(id);
        if (file) void sendChunks(id, file);
        break;
      }
      default:
        break;
    }
  };
}

function createChunkSender(ep: RtcEndpoint, bus: FileBus) {
  return async (id: string, file: File): Promise<void> => {
    let seq = 0;
    const reader = file.stream().getReader();

    for (;;) {
      // biome-ignore lint/performance/noAwaitInLoops: sequential read maintains chunk order
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;

      let offset = 0;
      while (offset < value.byteLength) {
        const slice = value.subarray(offset, Math.min(offset + CHUNK_SIZE, value.byteLength));
        // biome-ignore lint/performance/noAwaitInLoops: enforce backpressure before sending next slice
        await sendJSONChunk(ep, bus, { id, seq, last: false, b64: toBase64Url(slice) });
        seq += 1;
        offset += slice.byteLength;
      }
    }

    await sendJSONChunk(ep, bus, { id, seq, last: true, b64: '' });
  };
}

async function sendJSONChunk(
  ep: RtcEndpoint,
  bus: FileBus,
  chunk: { id: string; seq: number; last: boolean; b64: string },
): Promise<void> {
  await waitBufferedLow(ep, 1_000_000);
  bus.sendJSON({ type: 'chunk', ...chunk } satisfies MsgChunk);
}

function setupConnectionGuards(
  ep: RtcEndpoint,
  onDisconnect?: (reason: string) => void,
): () => void {
  const handleClose = (): void => onDisconnect?.('channel_closed');
  const handleStateChange = (): void => {
    const state = ep.pc.connectionState;
    if (state === 'failed' || state === 'disconnected' || state === 'closed') handleClose();
  };

  ep.channel.addEventListener('close', handleClose);
  ep.pc.addEventListener('connectionstatechange', handleStateChange);

  return () => {
    try {
      ep.channel.removeEventListener('close', handleClose);
    } catch {}
    try {
      ep.pc.removeEventListener('connectionstatechange', handleStateChange);
    } catch {}
  };
}

// ------------- вспомогательные компоненты -------------

function Dropzone(props: {
  onInputChange: (e: Event) => void;
  onDrop: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
}): JSX.Element {
  let inputRef: HTMLInputElement | undefined;

  const triggerSelect = (): void => {
    inputRef?.click();
  };

  return (
    <div class="rounded-2xl border border-white/70 bg-white/70 p-4 shadow-sm">
      <button
        type="button"
        class="flex h-44 w-full flex-col items-center justify-center rounded-xl border-2 border-gray-300 border-dashed bg-gray-50 hover:bg-gray-100 md:h-56"
        onClick={triggerSelect}
        onDrop={props.onDrop}
        onDragOver={props.onDragOver}
      >
        <div class="flex flex-col items-center justify-center pt-5 pb-6 text-center">
          <svg
            class="mb-2 h-7 w-7 text-gray-500"
            viewBox="0 0 20 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6m0 0L8 8m2-2 2 2"
            />
          </svg>
          <p class="text-gray-600 text-sm">
            <span class="font-medium">Кликните</span> или перетащите файлы
          </p>
          <p class="text-gray-500 text-xs">P2P через WebRTC. На сервер не грузим</p>
        </div>
        <input
          ref={(node: HTMLInputElement | null) => {
            inputRef = node ?? undefined;
          }}
          type="file"
          class="hidden"
          multiple
          onChange={props.onInputChange}
        />
      </button>
    </div>
  );
}

function PeerHeaderSimple(props: { label: string; count: number; you?: boolean }): JSX.Element {
  return (
    <div class="flex items-center justify-between border-gray-200 border-b px-4 py-2">
      <div class="flex min-w-0 items-center gap-2">
        <span
          class={`h-2.5 w-2.5 rounded-full ${
            props.you ? 'bg-emerald-500' : 'bg-sky-500'
          } shrink-0 border border-white`}
        />
        <span class="truncate font-medium text-sm">
          {props.label}
          {props.you ? ' (you)' : ''}
        </span>
      </div>
      <span class="rounded-full border border-orange-200 bg-orange-100 px-2 py-0.5 text-[11px] text-orange-800">
        {props.count}
      </span>
    </div>
  );
}

function MyFileList(props: { files: FileMeta[]; onRemove: (id: string) => void }): JSX.Element {
  return (
    <div class="p-2">
      <div class="max-h-56 space-y-1.5 overflow-y-auto">
        <For each={props.files}>
          {(file: FileMeta) => (
            <div class="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 hover:bg-gray-50">
              <div class="flex min-w-0 flex-1 items-center gap-2">
                <p class="truncate text-slate-800 text-sm">{file.name}</p>
                <span class="shrink-0 text-[11px] text-slate-500">{fmtSize(file.size)}</span>
              </div>
              <button
                type="button"
                class="rounded border border-rose-200 px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-50"
                onClick={() => props.onRemove(file.id)}
              >
                Удалить
              </button>
            </div>
          )}
        </For>
        <Show when={props.files.length === 0}>
          <div class="rounded-lg border border-gray-300 border-dashed bg-gray-50 px-3 py-6 text-center text-slate-500 text-sm">
            Нет файлов
          </div>
        </Show>
      </div>
    </div>
  );
}

function GuestList(props: { files: RemoteMeta[]; onRequest: (id: string) => void }): JSX.Element {
  return (
    <div class="p-2">
      <div class="max-h-56 space-y-1.5 overflow-y-auto">
        <For each={props.files}>
          {(file: RemoteMeta) => (
            <div class="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 hover:bg-gray-50">
              <div class="flex min-w-0 flex-1 items-center gap-2">
                <p class="truncate text-slate-800 text-sm">{file.name}</p>
                <span class="shrink-0 text-[11px] text-slate-500">{fmtSize(file.size)}</span>
              </div>
              <Show
                when={file.url}
                fallback={
                  <button
                    type="button"
                    class="rounded border border-slate-200 px-2 py-1 text-[11px] hover:bg-slate-50 disabled:opacity-50"
                    disabled={file.downloading}
                    onClick={() => props.onRequest(file.id)}
                  >
                    {file.downloading ? 'Ждём…' : 'Скачать'}
                  </button>
                }
              >
                {(url: Accessor<string>) => (
                  <a
                    href={url()}
                    download={file.name}
                    class="rounded border border-slate-200 px-2 py-1 text-[11px] hover:bg-slate-50"
                  >
                    Скачать
                  </a>
                )}
              </Show>
            </div>
          )}
        </For>
        <Show when={props.files.length === 0}>
          <div class="rounded-lg border border-gray-300 border-dashed bg-gray-50 px-3 py-6 text-center text-slate-500 text-sm">
            Нет файлов
          </div>
        </Show>
      </div>
    </div>
  );
}

// ---------- простой backpressure ----------
function waitBufferedLow(ep: RtcEndpoint, lowMark: number): Promise<void> {
  const dc = ep.channel;
  if (dc.bufferedAmount < lowMark) return Promise.resolve();
  return new Promise((resolve) => {
    const handler = (): void => {
      if (dc.bufferedAmount < lowMark) {
        dc.removeEventListener('bufferedamountlow', handler);
        resolve();
      }
    };
    try {
      dc.bufferedAmountLowThreshold = lowMark;
    } catch {}
    dc.addEventListener('bufferedamountlow', handler);
    const timer = setInterval(() => {
      if (dc.bufferedAmount < lowMark) {
        clearInterval(timer);
        dc.removeEventListener('bufferedamountlow', handler);
        resolve();
      }
    }, 50);
  });
}
