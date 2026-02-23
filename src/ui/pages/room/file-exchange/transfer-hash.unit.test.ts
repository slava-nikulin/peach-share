import { describe, expect, it } from 'vitest';
import {
  createTransferHashAccumulator,
  finalizeTransferHashAccumulator,
  isSameFileHash,
  isValidSha256Hex,
  normalizeHashValue,
  updateTransferHashAccumulator,
} from './transfer-hash';

describe('transfer hash helpers', () => {
  it('computes SHA-256 incrementally and finalizes idempotently', () => {
    const accumulator = createTransferHashAccumulator();

    updateTransferHashAccumulator(accumulator, new Uint8Array([1, 2]));
    updateTransferHashAccumulator(accumulator, new Uint8Array([3, 4]));

    const first = finalizeTransferHashAccumulator(accumulator);
    const second = finalizeTransferHashAccumulator(accumulator);

    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(first?.alg).toBe('sha256');
    expect(isValidSha256Hex(first?.value ?? '')).toBe(true);
  });

  it('compares hashes case-insensitively by normalized value', () => {
    const left = {
      alg: 'sha256' as const,
      value: 'AA'.padEnd(64, '0'),
    };
    const right = {
      alg: 'sha256' as const,
      value: normalizeHashValue(left.value),
    };

    expect(isSameFileHash(left, right)).toBe(true);
  });
});
