import { type Accessor, createSignal, type Setter } from 'solid-js';
import { fromBase64Url, toBase64Url } from '../../../../lib/crypto';
import type { FileBus } from '../../../../lib/file-bus';
import type { RtcEndpoint } from '../../../../lib/webrtc';

const MAX_FILE_SIZE: number = 200 * 1024 * 1024; // 200MB
const CHUNK_SIZE: number = 64 * 1024; // 64KB payload

export interface FileMeta {
  id: string;
  name: string;
  size: number;
  addedAt: number;
}

export type RemoteMeta = FileMeta & { downloading?: boolean; url?: string };

export interface LocalFilesState {
  files: Accessor<FileMeta[]>;
  addFiles: (files: FileList | File[]) => Promise<void>;
  removeFile: (id: string) => void;
  fileById: (id: string) => File | undefined;
  syncWithPeer: () => void;
}

export interface RemoteFilesState {
  files: Accessor<RemoteMeta[]>;
  requestFile: (id: string) => void;
  handleSync: (files: FileMeta[]) => void;
  handleAnnounce: (file: FileMeta) => void;
  handleRemove: (id: string) => void;
  handleChunk: (chunk: MsgChunk) => void;
  cleanup: () => void;
}

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

export function createLocalFilesState(bus: FileBus): LocalFilesState {
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

export function createRemoteFilesState(bus: FileBus): RemoteFilesState {
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

export function createControlMessageHandler(
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

export function createChunkSender(ep: RtcEndpoint, bus: FileBus) {
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

export function setupConnectionGuards(
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

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
