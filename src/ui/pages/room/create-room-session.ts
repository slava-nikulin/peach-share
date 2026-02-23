import type { P2pChannel } from '../../../bll/ports/p2p-channel';
import { FileExchangeSessionBuilder } from './file-exchange/session-builder';
import type {
  FileDesc as ExchangeFileDesc,
  SessionError,
  TransferTerminalEvent,
} from './file-exchange/types';

type TransferDir = 'send' | 'recv';

export interface FileDesc {
  id: string;
  name: string;
  size: number;
  mime: string;
}

export interface TransferState {
  fileId: string;
  dir: TransferDir;
  percentage: number;
  bytes: number;
  status: 'preparing' | 'active' | 'done' | 'cancelled' | 'error';
  error?: string;
}

export interface RoomSession {
  addMyFiles(files: FileList): Promise<void>;
  unshare(fileId: string): void;
  requestDownload(fileId: string): void;
  dispose(): void;
}

export function createRoomSession(params: {
  channel: P2pChannel;
  setMyFiles: (v: FileDesc[]) => void;
  getMyFiles: () => FileDesc[];
  setPeerFiles: (v: FileDesc[]) => void;
  getPeerFiles: () => FileDesc[];
  setTransfers: (v: TransferState[]) => void;
  getTransfers: () => TransferState[];
  onDownloadedFile: (file: File) => void;
}): RoomSession {
  const {
    channel,
    setMyFiles,
    getMyFiles,
    setPeerFiles,
    getPeerFiles,
    setTransfers,
    getTransfers,
    onDownloadedFile,
  } = params;

  const fxSession = new FileExchangeSessionBuilder(channel).build();
  const transferContext = new Map<string, { fileId: string; dir: TransferDir }>();

  const upsertTransfer = (
    patch: Partial<TransferState> & Pick<TransferState, 'fileId' | 'dir'>,
  ): void => {
    const current = getTransfers().slice();
    const index = current.findIndex((item) => item.fileId === patch.fileId && item.dir === patch.dir);

    const previous = index >= 0 ? current[index] : null;
    const next: TransferState = {
      fileId: patch.fileId,
      dir: patch.dir,
      percentage: patch.percentage ?? previous?.percentage ?? 0,
      bytes: patch.bytes ?? previous?.bytes ?? 0,
      status: patch.status ?? previous?.status ?? 'preparing',
      error: patch.error ?? previous?.error,
    };

    if (index >= 0) {
      current[index] = next;
    } else {
      current.push(next);
    }

    setTransfers(current);
  };

  const markTransferError = (context: { fileId: string; dir: TransferDir }, error: unknown): void => {
    upsertTransfer({
      fileId: context.fileId,
      dir: context.dir,
      status: 'error',
      error: errorMessage(error),
    });
  };

  const applyTerminal = (event: TransferTerminalEvent): void => {
    const context = transferContext.get(event.transferId) ?? {
      fileId: event.fileId,
      dir: event.dir === 'send' ? 'send' : 'recv',
    };

    if (event.status === 'completed') {
      upsertTransfer({
        fileId: context.fileId,
        dir: context.dir,
        status: 'done',
        bytes: event.done,
        percentage: 100,
        error: undefined,
      });
      transferContext.delete(event.transferId);
      return;
    }

    if (event.status === 'cancelled') {
      upsertTransfer({
        fileId: context.fileId,
        dir: context.dir,
        status: 'cancelled',
        bytes: event.done,
        percentage: event.total > 0 ? Math.min(100, (event.done / event.total) * 100) : 0,
        error: undefined,
      });
      transferContext.delete(event.transferId);
      return;
    }

    upsertTransfer({
      fileId: context.fileId,
      dir: context.dir,
      status: 'error',
      bytes: event.done,
      percentage: event.total > 0 ? Math.min(100, (event.done / event.total) * 100) : 0,
      error: `${event.code}: ${event.message}`,
    });
    transferContext.delete(event.transferId);
  };

  const unsubLocal = fxSession.onLocalFilesChanged((files) => {
    setMyFiles(files.map(toUiFileDesc));
  });

  const unsubPeer = fxSession.onPeerFilesChanged((files) => {
    setPeerFiles(files.map(toUiFileDesc));
  });

  const unsubProgress = fxSession.onTransferProgress((progress) => {
    const dir: TransferDir = progress.dir === 'send' ? 'send' : 'recv';
    transferContext.set(progress.transferId, { fileId: progress.fileId, dir });

    const done = Math.max(0, progress.done);
    const total = Math.max(0, progress.total);
    const percentage = total > 0 ? Math.min(100, (done / total) * 100) : 0;

    const status: TransferState['status'] = done > 0 ? 'active' : 'preparing';

    upsertTransfer({
      fileId: progress.fileId,
      dir,
      bytes: done,
      percentage,
      status,
      error: undefined,
    });
  });

  const unsubTerminal = fxSession.onTransferTerminal((event) => {
    applyTerminal(event);
  });

  const unsubError = fxSession.onError((error) => {
    if (error.scope === 'transfer' && error.transferId) {
      const context = transferContext.get(error.transferId);
      if (context) {
        markTransferError(context, `${error.code}: ${error.message}`);
      }
      return;
    }

    const _unused = error as SessionError;
    void _unused;
  });

  return {
    async addMyFiles(files: FileList): Promise<void> {
      await fxSession.addLocal(files);
      if (getMyFiles().length === 0) {
        setMyFiles(fxSession.localFiles().map(toUiFileDesc));
      }
    },

    unshare(fileId: string): void {
      fxSession.unshare(fileId);
    },

    requestDownload(fileId: string): void {
      const requested = getPeerFiles().find((file) => file.id === fileId);
      if (!requested) return;

      upsertTransfer({ fileId, dir: 'recv', status: 'preparing', percentage: 0, bytes: 0 });

      if (canUseFileSystemSink()) {
        void startStreamingDownloadToFile(fileId, requested);
        return;
      }

      startMemoryDownload(fileId, requested);
    },

    dispose(): void {
      unsubLocal();
      unsubPeer();
      unsubProgress();
      unsubTerminal();
      unsubError();
      fxSession.dispose();
      transferContext.clear();
    },
  };

  function startMemoryDownload(fileId: string, requested: FileDesc): void {
    const handle = fxSession.requestDownload(fileId);
    transferContext.set(handle.transferId, { fileId, dir: 'recv' });

    void handle.result
      .then((blob) => {
        const peerMeta = getPeerFiles().find((file) => file.id === fileId);
        const fileName = peerMeta?.name || requested.name || `download-${fileId}`;
        const fileMime = blob.type || peerMeta?.mime || 'application/octet-stream';

        const downloaded = new File([blob], fileName, {
          type: fileMime,
          lastModified: Date.now(),
        });

        onDownloadedFile(downloaded);
      })
      .catch((error) => {
        const context = transferContext.get(handle.transferId) ?? { fileId, dir: 'recv' as const };
        markTransferError(context, error);
      });
  }

  async function startStreamingDownloadToFile(fileId: string, requested: FileDesc): Promise<void> {
    try {
      const sink = await createFileDownloadSink(requested.name, requested.mime);
      const handle = fxSession.requestDownloadTo(fileId, sink);
      transferContext.set(handle.transferId, { fileId, dir: 'recv' });
      await handle.done;
    } catch (error) {
      if (isAbortError(error)) {
        upsertTransfer({
          fileId,
          dir: 'recv',
          status: 'cancelled',
          percentage: 0,
          bytes: 0,
          error: undefined,
        });
        return;
      }

      markTransferError({ fileId, dir: 'recv' }, error);

      // Best effort fallback for browsers with partially supported FS APIs.
      startMemoryDownload(fileId, requested);
    }
  }
}

function toUiFileDesc(file: ExchangeFileDesc): FileDesc {
  return {
    id: file.id,
    name: file.name,
    size: file.size,
    mime: file.mime,
  };
}

function canUseFileSystemSink(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
}

async function createFileDownloadSink(fileName: string, mime: string): Promise<WritableStream<Uint8Array>> {
  const picker = (window as Window & {
    showSaveFilePicker?: (opts: {
      suggestedName: string;
      types: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<{ createWritable: () => Promise<{ write: (data: Uint8Array) => Promise<void>; close: () => Promise<void>; abort: (reason?: unknown) => Promise<void> }> }>;
  }).showSaveFilePicker;

  if (!picker) {
    throw new Error('File System Access API is not available');
  }

  const fileHandle = await picker({
    suggestedName: fileName,
    types: [
      {
        description: 'Downloaded file',
        accept: {
          [mime || 'application/octet-stream']: ['.*'],
        },
      },
    ],
  });

  const writable = await fileHandle.createWritable();

  return new WritableStream<Uint8Array>({
    write(chunk): Promise<void> {
      return writable.write(chunk);
    },
    close(): Promise<void> {
      return writable.close();
    },
    abort(reason): Promise<void> {
      return writable.abort(reason);
    },
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
