import { describe, expect, it } from 'vitest';
import {
  decodeWire,
  encodeControlWire,
  encodeDataWire,
  newTransferId,
  transferIdFrom16,
  transferIdTo16,
} from './wire';

describe('wire codec', () => {
  it('encodes/decodes control wire and returns copied payload', () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const encoded = encodeControlWire(payload);
    const decoded = decodeWire(encoded);

    expect(decoded.k).toBe('control');
    if (decoded.k !== 'control') return;

    encoded[2] = 99;
    expect(Array.from(decoded.bytes)).toEqual([1, 2, 3, 4]);
  });

  it('encodes/decodes data wire and returns copied transferId/payload', () => {
    const { transferId16 } = newTransferId();
    const payload = new Uint8Array([5, 6, 7, 8]);

    const encoded = encodeDataWire({ transferId16, seq: 42, eof: true, payload });
    const decoded = decodeWire(encoded);

    expect(decoded.k).toBe('data');
    if (decoded.k !== 'data') return;

    expect(decoded.seq).toBe(42);
    expect(decoded.eof).toBe(true);
    expect(Array.from(decoded.payload)).toEqual([5, 6, 7, 8]);

    encoded[1] = 255;
    encoded[22] = 255;

    expect(Array.from(decoded.transferId16)).toEqual(Array.from(transferId16));
    expect(Array.from(decoded.payload)).toEqual([5, 6, 7, 8]);
  });

  it('roundtrips transfer id conversions', () => {
    const { transferId, transferId16 } = newTransferId();

    expect(Array.from(transferIdTo16(transferId))).toEqual(Array.from(transferId16));
    expect(transferIdFrom16(transferId16)).toBe(transferId);
  });

  it('throws on unknown wire kind', () => {
    expect(() => decodeWire(new Uint8Array([99, 1, 2, 3]))).toThrow(/unknown wire kind/i);
  });
});
