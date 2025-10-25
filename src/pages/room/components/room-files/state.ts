import { type Accessor, createSignal, type Setter } from 'solid-js';
import type { FileBus } from '../../../../lib/file-bus';
import type { RtcEndpoint } from '../../../../lib/webrtc';
import type { FileTransfer, FileTransferMeta } from './file-transfer';

type TransferListener = Parameters<FileTransfer['onFile']>[0];
type TransferEvent = Parameters<TransferListener>[0];

const MAX_FILE_SIZE: number = 200 * 1024 * 1024; // 200MB

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

export class RemoteFilesState {
  public readonly files: Accessor<RemoteMeta[]>;

  private readonly setFiles: Setter<RemoteMeta[]>;
  private readonly urlRegistry = new Map<string, string>();
  private readonly pendingAutoDownloads = new Set<string>();
  private readonly removeTransferListener: () => void;
  private readonly bus: FileBus;
  private readonly transfer: FileTransfer;

  public constructor(bus: FileBus, transfer: FileTransfer) {
    this.bus = bus;
    this.transfer = transfer;
    const [files, setFiles] = createSignal<RemoteMeta[]>([]);
    this.files = files;
    this.setFiles = setFiles;
    this.removeTransferListener = this.transfer.onFile((event) => this.handleTransferEvent(event));
  }

  public handleSync(list: FileMeta[]): void {
    const keepIds = new Set(list.map((file) => file.id));
    this.revokeMissingUrls(keepIds);
    for (const id of Array.from(this.pendingAutoDownloads)) {
      if (!keepIds.has(id)) {
        this.pendingAutoDownloads.delete(id);
      }
    }
    this.setFiles(list.map((file) => ({ ...file, downloading: false })));
  }

  public handleAnnounce(file: FileMeta): void {
    this.setFiles((prev) => {
      if (prev.some((existing) => existing.id === file.id)) return prev;
      return [...prev, { ...file }];
    });
  }

  public handleRemove(id: string): void {
    this.revokeUrl(id);
    this.setFiles((prev) => prev.filter((file) => file.id !== id));
  }

  public requestFile(id: string): void {
    this.pendingAutoDownloads.add(id);
    this.setFiles((prev) =>
      prev.map((file) => (file.id === id ? { ...file, downloading: true, url: file.url } : file)),
    );
    this.bus.sendJSON({ type: 'request', id } satisfies MsgRequest);
  }

  public cleanup(): void {
    this.removeTransferListener();
    this.cleanupUrls();
    this.pendingAutoDownloads.clear();
    this.setFiles([]);
  }

  private handleTransferEvent(event: TransferEvent): void {
    if (event.status === 'complete') {
      const url = URL.createObjectURL(event.blob);
      const prev = this.urlRegistry.get(event.meta.id);
      if (prev) URL.revokeObjectURL(prev);
      this.urlRegistry.set(event.meta.id, url);
      this.setFiles((prev) =>
        prev.map((file) =>
          file.id === event.meta.id ? { ...file, url, downloading: false } : file,
        ),
      );
      if (this.pendingAutoDownloads.delete(event.meta.id)) {
        this.triggerAutoDownload(event.meta, url);
      }
      return;
    }

    if (event.status === 'cancelled' || event.status === 'error') {
      this.pendingAutoDownloads.delete(event.meta.id);
      this.setFiles((prev) =>
        prev.map((file) => (file.id === event.meta.id ? { ...file, downloading: false } : file)),
      );
    }
  }

  private revokeUrl(id: string): void {
    const existing = this.urlRegistry.get(id);
    if (existing) {
      URL.revokeObjectURL(existing);
      this.urlRegistry.delete(id);
      return;
    }

    const record = this.files().find((file) => file.id === id);
    if (record?.url) URL.revokeObjectURL(record.url);
  }

  private revokeMissingUrls(keepIds: Set<string>): void {
    this.files().forEach((file) => {
      if (!keepIds.has(file.id)) {
        const stored = this.urlRegistry.get(file.id);
        if (stored) {
          URL.revokeObjectURL(stored);
          this.urlRegistry.delete(file.id);
        } else if (file.url) {
          URL.revokeObjectURL(file.url);
        }
      }
    });
  }

  private cleanupUrls(): void {
    for (const url of this.urlRegistry.values()) {
      URL.revokeObjectURL(url);
    }
    this.urlRegistry.clear();
    this.files().forEach((file) => {
      if (file.url) URL.revokeObjectURL(file.url);
    });
  }

  private triggerAutoDownload(meta: FileTransferMeta, url: string): void {
    if (typeof document === 'undefined') return;
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = meta.name ?? 'download';
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }
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

interface MsgSync {
  type: 'sync';
  files: FileMeta[];
}

type CtrlMsg = MsgAnnounce | MsgRemove | MsgRequest | MsgSync;

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

export function createRemoteFilesState(bus: FileBus, transfer: FileTransfer): RemoteFilesState {
  return new RemoteFilesState(bus, transfer);
}

export function createControlMessageHandler(
  local: LocalFilesState,
  remote: RemoteFilesState,
  transfer: FileTransfer,
): (msg: unknown) => void {
  return (raw: unknown) => {
    const msg = raw as Partial<CtrlMsg> & { type?: string };
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type.startsWith('transfer:')) return;

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
      case 'request': {
        const { id } = msg as MsgRequest;
        const file = local.fileById(id);
        if (file) {
          const meta = local.files().find((entry) => entry.id === id);
          if (meta) {
            void transfer.send(file, meta as FileTransferMeta).catch(() => {});
          }
        }
        break;
      }
      default:
        break;
    }
  };
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
