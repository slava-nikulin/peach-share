export type SessionState = 'ready' | 'closed';

type Brand<T, B extends string> = T & { readonly __brand: B };
export type TransferId = Brand<string, 'TransferId'>;
export type FileId = Brand<string, 'FileId'>;

export type HashAlg = 'sha256';

export interface FileHash {
  alg: HashAlg;
  value: string;
}

export interface FileDesc {
  id: string;
  name: string;
  size: number;
  mime: string;
  mtime?: number;
  hash?: FileHash;
}

export type TransferDir = 'send' | 'recv';

export interface TransferProgress {
  dir: TransferDir;
  transferId: string;
  fileId: string;
  done: number;
  total: number;
}

export type SessionErrorCode =
  | 'SESSION_CLOSED'
  | 'BUILD_MISMATCH'
  | 'TRANSPORT_PROTOCOL_VIOLATION'
  | 'TRANSPORT_MESSAGE_TOO_LARGE'
  | 'CONTROL_ENCODE_FAILED'
  | 'CONTROL_DECODE_FAILED'
  | 'CONTROL_SEND_FAILED'
  | 'PROTOCOL_VIOLATION'
  | 'NEGOTIATION_FAILED'
  | 'INVENTORY_SYNC_FAILED'
  | 'INTERNAL_ERROR';

export type TransferFailureCode =
  | 'NOT_FOUND'
  | 'SEND_FAILED'
  | 'RECV_FAILED'
  | 'META_TIMEOUT'
  | 'IDLE_TIMEOUT'
  | 'HARD_TIMEOUT'
  | 'OUT_OF_ORDER'
  | 'SIZE_OVERFLOW'
  | 'SIZE_MISMATCH'
  | 'HASH_MISMATCH'
  | 'FILE_ID_MISMATCH'
  | 'LIMIT_FILE_SIZE'
  | 'LIMIT_CONCURRENT_INCOMING'
  | 'LIMIT_CONCURRENT_OUTGOING'
  | 'LIMIT_BUFFERED_BYTES'
  | 'LIMIT_MEMORY_DOWNLOAD'
  | 'SINK_WRITE_FAILED'
  | 'PEER_ERROR'
  | 'PROTOCOL_VIOLATION'
  | 'INVALID_TRANSFER_ID';

export type TransferCancelReason =
  | 'USER_CANCELLED'
  | 'PEER_CANCELLED'
  | 'SESSION_CLOSED'
  | 'DISPOSED';

export interface SessionError {
  scope: 'session' | 'transfer';
  code: SessionErrorCode | TransferFailureCode;
  transferId?: string;
  message: string;
  cause?: unknown;
}

export type TransferTerminalEvent = {
  dir: TransferDir;
  transferId: string;
  fileId: string;
  done: number;
  total: number;
} & (
  | {
      status: 'completed';
    }
  | {
      status: 'failed';
      code: TransferFailureCode;
      message: string;
      cause?: unknown;
    }
  | {
      status: 'cancelled';
      reason: TransferCancelReason;
      message?: string;
    }
);

export interface DownloadHandle {
  transferId: string;
  /** Resolves with Blob when completed (may use memory fallback). */
  result: Promise<Blob>;
  cancel: () => void;
}

export interface DownloadToSinkHandle {
  transferId: string;
  /** Resolves when sink was fully written and closed. */
  done: Promise<void>;
  cancel: () => void;
}

export interface FileExchangeSession {
  state(): SessionState;
  onStateChanged(cb: (s: SessionState) => void): () => void;

  dispose(): void;

  addLocal(files: FileList | File[]): Promise<void>;
  unshare(fileId: string): void;

  localFiles(): readonly FileDesc[];
  onLocalFilesChanged(cb: (files: readonly FileDesc[]) => void): () => void;

  peerFiles(): readonly FileDesc[];
  onPeerFilesChanged(cb: (files: readonly FileDesc[]) => void): () => void;

  requestDownload(fileId: string): DownloadHandle;
  requestDownloadTo(fileId: string, sink: WritableStream<Uint8Array>): DownloadToSinkHandle;

  cancelTransfer(transferId: string): void;

  onTransferProgress(cb: (p: TransferProgress) => void): () => void;
  onTransferTerminal(cb: (event: TransferTerminalEvent) => void): () => void;
  onError(cb: (e: SessionError) => void): () => void;
}
