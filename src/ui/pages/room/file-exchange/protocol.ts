import type { FileDesc, FileHash, HashAlg } from './types';

export const PROTOCOL_ID = 'fx/2' as const;
export const PROTOCOL_V2_ID = PROTOCOL_ID;
export type Protocol = typeof PROTOCOL_ID;

export const HASH_MODE_SHA256_END = 'sha256-end' as const;
export type HashMode = typeof HASH_MODE_SHA256_END;

export type HelloCapabilities = {
  maxMessageBytes: number;
  chunkBytes: number;
  maxFileBytes: number;
  hash: {
    algorithms: HashAlg[];
    modes: HashMode[];
  };
  inventory: {
    versioning: boolean;
    paging: boolean;
  };
};

export type HelloMsg = {
  p: Protocol;
  t: 'HELLO';
  sessionId: string;
  appBuildId: string;
  caps?: HelloCapabilities;
};

export type InventorySnapshotMsg = {
  p: Protocol;
  t: 'INVENTORY_SNAPSHOT';
  files: FileDesc[];
  inventoryVersion?: number;
};

export type InventoryDeltaMsg = {
  p: Protocol;
  t: 'INVENTORY_DELTA';
  add?: FileDesc[];
  remove?: string[];
  baseVersion?: number;
  nextVersion?: number;
};

export type InventoryResyncRequestMsg = {
  p: Protocol;
  t: 'INVENTORY_RESYNC_REQUEST';
  reason?: string;
};

export type InventorySnapshotBeginMsg = {
  p: Protocol;
  t: 'INVENTORY_SNAPSHOT_BEGIN';
  snapshotId: string;
  inventoryVersion: number;
  totalParts: number;
};

export type InventorySnapshotPartMsg = {
  p: Protocol;
  t: 'INVENTORY_SNAPSHOT_PART';
  snapshotId: string;
  partIndex: number;
  files: FileDesc[];
};

export type InventorySnapshotEndMsg = {
  p: Protocol;
  t: 'INVENTORY_SNAPSHOT_END';
  snapshotId: string;
  inventoryVersion: number;
  totalParts: number;
};

export type GetFileMsg = {
  p: Protocol;
  t: 'GET_FILE';
  transferId: string;
  fileId: string;
};

export type FileMetaMsg = {
  p: Protocol;
  t: 'FILE_META';
  transferId: string;
  file: {
    id: string;
    name: string;
    size: number;
    mime: string;
    mtime?: number;
    hash?: FileHash;
  };
};

export type FileChunkMsg = {
  p: Protocol;
  t: 'FILE_CHUNK';
  transferId: string;
  seq: number;
  eof?: boolean;
  data: Uint8Array;
};

export type FileEndMsg = {
  p: Protocol;
  t: 'FILE_END';
  transferId: string;
  hash?: FileHash;
};

export type CancelMsg = {
  p: Protocol;
  t: 'CANCEL';
  transferId: string;
  reason?: string;
};

export type ErrorMsg = {
  p: Protocol;
  t: 'ERROR';
  scope: 'session' | 'transfer';
  transferId?: string;
  code: string;
  message: string;
};

export type ControlMsg =
  | HelloMsg
  | InventorySnapshotMsg
  | InventoryDeltaMsg
  | InventoryResyncRequestMsg
  | InventorySnapshotBeginMsg
  | InventorySnapshotPartMsg
  | InventorySnapshotEndMsg
  | GetFileMsg
  | FileMetaMsg
  | FileEndMsg
  | CancelMsg
  | ErrorMsg;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type ControlMsgWithoutProtocol = DistributiveOmit<ControlMsg, 'p'>;

/**
 * Strict runtime checks for CONTROL messages.
 * FILE_CHUNK is carried via binary wire data frames.
 */
export function isControlMsg(x: unknown): x is ControlMsg {
  if (!isRecord(x)) return false;
  if (!isProtocol(x.p)) return false;

  switch (x.t) {
    case 'HELLO':
      return (
        isNonEmptyString(x.sessionId) &&
        isNonEmptyString(x.appBuildId) &&
        (x.caps == null || isHelloCapabilities(x.caps))
      );

    case 'INVENTORY_SNAPSHOT':
      return (
        Array.isArray(x.files) &&
        x.files.every(isFileDesc) &&
        (x.inventoryVersion == null || isFiniteNonNegativeInteger(x.inventoryVersion))
      );

    case 'INVENTORY_DELTA':
      return (
        (x.add == null || (Array.isArray(x.add) && x.add.every(isFileDesc))) &&
        (x.remove == null || (Array.isArray(x.remove) && x.remove.every(isNonEmptyString))) &&
        (x.baseVersion == null || isFiniteNonNegativeInteger(x.baseVersion)) &&
        (x.nextVersion == null || isFiniteNonNegativeInteger(x.nextVersion))
      );

    case 'INVENTORY_RESYNC_REQUEST':
      return x.reason == null || isNonEmptyString(x.reason);

    case 'INVENTORY_SNAPSHOT_BEGIN':
      return (
        isNonEmptyString(x.snapshotId) &&
        isFiniteNonNegativeInteger(x.inventoryVersion) &&
        isFinitePositiveInteger(x.totalParts)
      );

    case 'INVENTORY_SNAPSHOT_PART':
      return (
        isNonEmptyString(x.snapshotId) &&
        isFiniteNonNegativeInteger(x.partIndex) &&
        Array.isArray(x.files) &&
        x.files.every(isFileDesc)
      );

    case 'INVENTORY_SNAPSHOT_END':
      return (
        isNonEmptyString(x.snapshotId) &&
        isFiniteNonNegativeInteger(x.inventoryVersion) &&
        isFinitePositiveInteger(x.totalParts)
      );

    case 'GET_FILE':
      return isNonEmptyString(x.transferId) && isNonEmptyString(x.fileId);

    case 'FILE_META':
      return isNonEmptyString(x.transferId) && isFileMetaPayload(x.file);

    case 'FILE_END':
      return isNonEmptyString(x.transferId) && (x.hash == null || isFileHash(x.hash));

    case 'CANCEL':
      return isNonEmptyString(x.transferId) && (x.reason == null || typeof x.reason === 'string');

    case 'ERROR':
      return (
        (x.scope === 'session' || x.scope === 'transfer') &&
        isNonEmptyString(x.code) &&
        isNonEmptyString(x.message) &&
        (x.transferId == null || isNonEmptyString(x.transferId))
      );

    default:
      return false;
  }
}

function isProtocol(x: unknown): x is Protocol {
  return x === PROTOCOL_ID;
}

function isHelloCapabilities(x: unknown): x is HelloCapabilities {
  if (!isRecord(x)) return false;

  if (
    !isFinitePositiveNumber(x.maxMessageBytes) ||
    !isFinitePositiveNumber(x.chunkBytes) ||
    !isFinitePositiveNumber(x.maxFileBytes)
  ) {
    return false;
  }

  if (!isRecord(x.hash)) return false;
  if (!Array.isArray(x.hash.algorithms) || !x.hash.algorithms.every(isHashAlg)) return false;
  if (!Array.isArray(x.hash.modes) || !x.hash.modes.every(isHashMode)) return false;

  if (!isRecord(x.inventory)) return false;
  if (typeof x.inventory.versioning !== 'boolean') return false;
  if (typeof x.inventory.paging !== 'boolean') return false;

  return true;
}

function isHashAlg(x: unknown): x is HashAlg {
  return x === 'sha256';
}

function isHashMode(x: unknown): x is HashMode {
  return x === HASH_MODE_SHA256_END;
}

function isFileMetaPayload(x: unknown): x is FileMetaMsg['file'] {
  if (!isRecord(x)) return false;
  return (
    isNonEmptyString(x.id) &&
    isNonEmptyString(x.name) &&
    isFiniteNonNegativeNumber(x.size) &&
    isNonEmptyString(x.mime) &&
    (x.mtime == null || isFiniteNonNegativeNumber(x.mtime)) &&
    (x.hash == null || isFileHash(x.hash))
  );
}

function isFileDesc(x: unknown): x is FileDesc {
  if (!isRecord(x)) return false;
  return (
    isNonEmptyString(x.id) &&
    isNonEmptyString(x.name) &&
    isFiniteNonNegativeNumber(x.size) &&
    isNonEmptyString(x.mime) &&
    (x.mtime == null || isFiniteNonNegativeNumber(x.mtime)) &&
    (x.hash == null || isFileHash(x.hash))
  );
}

function isFileHash(x: unknown): x is FileHash {
  if (!isRecord(x)) return false;
  return x.alg === 'sha256' && isNonEmptyString(x.value);
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x != null;
}

function isNonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.length > 0;
}

function isFinitePositiveNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0;
}

function isFinitePositiveInteger(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 && Number.isInteger(x);
}

function isFiniteNonNegativeInteger(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 && Number.isInteger(x);
}

function isFiniteNonNegativeNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0;
}
