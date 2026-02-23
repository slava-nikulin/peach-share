import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { FileHash } from './types';

type Sha256IncrementalHasher = {
  update(data: Uint8Array): void;
  digest(): Uint8Array;
};

export interface TransferHashAccumulator {
  hasher: Sha256IncrementalHasher;
  finalized?: FileHash;
}

export function createTransferHashAccumulator(): TransferHashAccumulator {
  const nativeHasher = sha256.create();
  const hasher: Sha256IncrementalHasher = {
    update(data: Uint8Array): void {
      nativeHasher.update(data);
    },
    digest(): Uint8Array {
      return nativeHasher.digest();
    },
  };

  return { hasher };
}

export function updateTransferHashAccumulator(
  accumulator: TransferHashAccumulator,
  payload: Uint8Array,
): void {
  if (accumulator.finalized) return;
  if (payload.length === 0) return;
  accumulator.hasher.update(payload);
}

export function finalizeTransferHashAccumulator(accumulator: TransferHashAccumulator): FileHash {
  if (!accumulator.finalized) {
    accumulator.finalized = {
      alg: 'sha256',
      value: normalizeHashValue(bytesToHex(accumulator.hasher.digest())),
    };
  }

  return accumulator.finalized;
}

export function isSameFileHash(left: FileHash, right: FileHash): boolean {
  return left.alg === right.alg && normalizeHashValue(left.value) === normalizeHashValue(right.value);
}

export function isValidSha256Hex(value: string): boolean {
  return /^[a-fA-F0-9]{64}$/.test(value);
}

export function normalizeHashValue(value: string): string {
  return value.toLowerCase();
}
