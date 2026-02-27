import type { P2pChannel } from '../../../bll/ports/p2p-channel';
import { FileExchangeSessionBuilder } from './file-exchange/session-builder';
import type { FileExchangeConfig } from './file-exchange/session-config';
import type {
  FileDesc as ExchangeFileDesc,
  SessionError,
  TransferTerminalEvent,
} from './file-exchange/types';

type TransferDir = 'send' | 'recv';
type SessionNoticeScope = 'session' | 'transfer';
type SessionNoticeCode = SessionError['code'] | 'NOT_FOUND' | 'INTERNAL_ERROR';

export type RoomSessionStatus = 'connecting' | 'ready' | 'error' | 'closed';

export interface FileDesc {
  id: string;
  name: string;
  size: number;
  mime: string;
}

export interface TransferState {
  transferId: string;
  fileId: string;
  dir: TransferDir;
  percentage: number;
  bytes: number;
  totalBytes: number;
  status: 'preparing' | 'active' | 'done' | 'cancelled' | 'error';
  error?: string;
}

export interface SessionNotice {
  scope: SessionNoticeScope;
  code: SessionNoticeCode;
  message: string;
  fatal: boolean;
  transferId?: string;
}

export interface RoomSession {
  addMyFiles(files: FileList): Promise<void>;
  unshare(fileId: string): boolean;
  requestDownload(fileId: string): Promise<void>;
  cancelTransfer(transferId: string): void;
  dispose(): void;
}

const ROOM_FILE_EXCHANGE_CONFIG: FileExchangeConfig = {
  controlMaxBytes: 32 * 1024,
  fileChunkBytes: 64 * 1024,
  inventoryResendIntervalMs: 10_000,

  maxConcurrentOutgoingTransfers: 2,
  maxConcurrentIncomingTransfers: 2,

  maxFileBytes: 128 * 1024 * 1024,
  maxBufferedIncomingBytes: 32 * 1024 * 1024,

  metaTimeoutMs: 15_000,
  idleTimeoutMs: 180_000,
  hardTimeoutMs: 60 * 60 * 1000,

  closeOnProtocolViolation: true,
};

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: todo refactor
export function createRoomSession(params: {
  channel: P2pChannel;
  setMyFiles: (v: FileDesc[]) => void;
  getMyFiles: () => FileDesc[];
  setPeerFiles: (v: FileDesc[]) => void;
  getPeerFiles: () => FileDesc[];
  setTransfers: (v: TransferState[]) => void;
  getTransfers: () => TransferState[];
  setSessionStatus: (v: RoomSessionStatus) => void;
  setReadOnly: (v: boolean) => void;
  setSessionNotice: (v: SessionNotice | null) => void;
}): RoomSession {
  const {
    channel,
    setMyFiles,
    getMyFiles,
    setPeerFiles,
    getPeerFiles,
    setTransfers,
    getTransfers,
    setSessionStatus,
    setReadOnly,
    setSessionNotice,
  } = params;

  const fxSession = new FileExchangeSessionBuilder(channel, ROOM_FILE_EXCHANGE_CONFIG).build();
  const transferContext = new Map<string, { fileId: string; dir: TransferDir }>();
  let hasFatalSessionError = false;

  setSessionStatus('connecting');
  setReadOnly(true);
  setSessionNotice(null);

  const syncSessionState = (): void => {
    if (fxSession.state() === 'closed') {
      setSessionStatus('closed');
      setReadOnly(true);
      return;
    }

    if (hasFatalSessionError) {
      setSessionStatus('error');
      setReadOnly(true);
      return;
    }

    setSessionStatus('ready');
    setReadOnly(false);
  };

  const publishNotice = (
    scope: SessionNoticeScope,
    code: SessionNoticeCode,
    message: string,
    fatal: boolean,
    transferId?: string,
  ): void => {
    setSessionNotice({
      scope,
      code,
      message,
      fatal,
      transferId,
    });
  };

  const upsertTransfer = (
    patch: Partial<TransferState> & Pick<TransferState, 'transferId' | 'fileId' | 'dir'>,
  ): void => {
    const current = getTransfers().slice();
    const index = current.findIndex((item) => item.transferId === patch.transferId);

    const previous = index >= 0 ? current[index] : null;
    const hasErrorPatch = 'error' in patch;
    const next: TransferState = {
      transferId: patch.transferId,
      fileId: patch.fileId,
      dir: patch.dir,
      percentage: patch.percentage ?? previous?.percentage ?? 0,
      bytes: patch.bytes ?? previous?.bytes ?? 0,
      totalBytes: patch.totalBytes ?? previous?.totalBytes ?? 0,
      status: patch.status ?? previous?.status ?? 'preparing',
      error: hasErrorPatch ? patch.error : previous?.error,
    };

    if (index >= 0) {
      current[index] = next;
    } else {
      current.push(next);
    }

    transferContext.set(patch.transferId, { fileId: patch.fileId, dir: patch.dir });
    setTransfers(current);
  };

  const markTransferErrorById = (transferId: string, error: unknown): void => {
    const existing = getTransfers().find((item) => item.transferId === transferId);
    const context =
      transferContext.get(transferId) ??
      (existing
        ? {
            fileId: existing.fileId,
            dir: existing.dir,
          }
        : null);

    if (!context) return;

    upsertTransfer({
      transferId,
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
    const done = Math.max(0, event.done);
    const total = Math.max(0, event.total);
    const percentage = total > 0 ? Math.min(100, (done / total) * 100) : 0;

    if (event.status === 'completed') {
      upsertTransfer({
        transferId: event.transferId,
        fileId: context.fileId,
        dir: context.dir,
        status: 'done',
        bytes: done,
        totalBytes: total,
        percentage: 100,
        error: undefined,
      });
      transferContext.delete(event.transferId);
      return;
    }

    if (event.status === 'cancelled') {
      upsertTransfer({
        transferId: event.transferId,
        fileId: context.fileId,
        dir: context.dir,
        status: 'cancelled',
        bytes: done,
        totalBytes: total,
        percentage,
        error: undefined,
      });
      transferContext.delete(event.transferId);
      return;
    }

    upsertTransfer({
      transferId: event.transferId,
      fileId: context.fileId,
      dir: context.dir,
      status: 'error',
      bytes: done,
      totalBytes: total,
      percentage,
      error: `${event.code}: ${event.message}`,
    });
    transferContext.delete(event.transferId);
  };

  const unsubState = fxSession.onStateChanged(() => {
    syncSessionState();
  });

  const unsubLocal = fxSession.onLocalFilesChanged((files) => {
    setMyFiles(files.map(toUiFileDesc));
  });

  const unsubPeer = fxSession.onPeerFilesChanged((files) => {
    setPeerFiles(files.map(toUiFileDesc));
  });

  const unsubProgress = fxSession.onTransferProgress((progress) => {
    const dir: TransferDir = progress.dir === 'send' ? 'send' : 'recv';

    const done = Math.max(0, progress.done);
    const total = Math.max(0, progress.total);
    const percentage = total > 0 ? Math.min(100, (done / total) * 100) : 0;

    const status: TransferState['status'] = done > 0 ? 'active' : 'preparing';

    upsertTransfer({
      transferId: progress.transferId,
      fileId: progress.fileId,
      dir,
      bytes: done,
      totalBytes: total,
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
      markTransferErrorById(error.transferId, `${error.code}: ${error.message}`);
      publishNotice(
        'transfer',
        normalizeNoticeCode(error),
        `${error.code}: ${error.message}`,
        false,
        error.transferId,
      );
      return;
    }

    const fatal = isFatalSessionError(error);
    if (fatal) {
      hasFatalSessionError = true;
    }

    publishNotice('session', normalizeNoticeCode(error), `${error.code}: ${error.message}`, fatal);
    syncSessionState();
  });

  syncSessionState();

  return {
    async addMyFiles(files: FileList): Promise<void> {
      try {
        await fxSession.addLocal(files);
        if (getMyFiles().length === 0) {
          setMyFiles(fxSession.localFiles().map(toUiFileDesc));
        }
      } catch (error) {
        publishNotice('session', normalizeUnknownErrorCode(error), errorMessage(error), false);
        throw error;
      }
    },

    unshare(fileId: string): boolean {
      const exists = getMyFiles().some((file) => file.id === fileId);
      if (!exists) return false;
      fxSession.unshare(fileId);
      return true;
    },

    async requestDownload(fileId: string): Promise<void> {
      const requested = getPeerFiles().find((file) => file.id === fileId);
      if (!requested) {
        publishNotice(
          'transfer',
          'NOT_FOUND',
          'File is no longer available in peer inventory.',
          false,
        );
        return;
      }

      await startBlobDownload(fileId, requested);
    },

    cancelTransfer(transferId: string): void {
      fxSession.cancelTransfer(transferId);
    },

    dispose(): void {
      unsubState();
      unsubLocal();
      unsubPeer();
      unsubProgress();
      unsubTerminal();
      unsubError();
      fxSession.dispose();
      transferContext.clear();
    },
  };

  async function startBlobDownload(fileId: string, requested: FileDesc): Promise<void> {
    const handle = fxSession.requestDownload(fileId);
    upsertTransfer({
      transferId: handle.transferId,
      fileId,
      dir: 'recv',
      status: 'preparing',
      percentage: 0,
      bytes: 0,
      totalBytes: requested.size,
      error: undefined,
    });

    try {
      const blob = await handle.result;
      const peerMeta = getPeerFiles().find((file) => file.id === fileId);
      const fileName = peerMeta?.name || requested.name || `download-${fileId}`;
      const fileMime = blob.type || peerMeta?.mime || requested.mime || 'application/octet-stream';
      triggerBrowserDownload(blob, fileName, fileMime);
    } catch (error) {
      markTransferErrorById(handle.transferId, error);
      publishNotice(
        'transfer',
        normalizeUnknownErrorCode(error),
        errorMessage(error),
        false,
        handle.transferId,
      );
      throw error;
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

function triggerBrowserDownload(blob: Blob, fileName: string, mime: string): void {
  const payload = blob.type ? blob : new Blob([blob], { type: mime });
  const objectUrl = URL.createObjectURL(payload);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  link.rel = 'noopener';
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 30_000);
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

function normalizeNoticeCode(error: SessionError): SessionNoticeCode {
  return error.code;
}

function normalizeUnknownErrorCode(error: unknown): SessionNoticeCode {
  if (typeof error === 'object' && error != null) {
    const maybeCode = (error as { code?: unknown }).code;
    if (typeof maybeCode === 'string') {
      return maybeCode as SessionNoticeCode;
    }
  }

  return 'INTERNAL_ERROR';
}

function isFatalSessionError(error: SessionError): boolean {
  if (error.scope !== 'session') return false;

  if (error.code === 'INVENTORY_SYNC_FAILED') {
    return false;
  }

  return true;
}
