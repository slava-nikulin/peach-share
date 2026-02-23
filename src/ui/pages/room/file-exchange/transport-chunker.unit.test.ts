import { describe, expect, it } from 'vitest';
import { fragmentMessage, Reassembler } from './transport-chunker';

describe('transport-chunker', () => {
  it('reassembles fragmented messages', () => {
    const input = new Uint8Array(10_000);
    for (let i = 0; i < input.length; i += 1) {
      input[i] = i % 251;
    }

    const reassembler = new Reassembler({ maxMessageBytes: 20_000 });

    let output: Uint8Array | null = null;
    for (const frame of fragmentMessage(input, 256)) {
      const maybe = reassembler.push(frame);
      if (maybe) {
        output = maybe;
      }
    }

    expect(output).not.toBeNull();
    expect(Array.from(output ?? [])).toEqual(Array.from(input));
  });

  it('rejects oversize SINGLE frame payloads', () => {
    const reassembler = new Reassembler({ maxMessageBytes: 4 });
    const frame = new Uint8Array([0x00, 1, 2, 3, 4, 5]);

    expect(() => reassembler.push(frame)).toThrow(/maxMessageBytes/);
  });

  it('rejects oversize START total length', () => {
    const reassembler = new Reassembler({ maxMessageBytes: 8 });
    const frame = new Uint8Array([0x01, 9, 0, 0, 0, 1]);

    expect(() => reassembler.push(frame)).toThrow(/maxMessageBytes/);
  });

  it('returns copied payload for SINGLE frames to prevent aliasing', () => {
    const reassembler = new Reassembler({ maxMessageBytes: 16 });
    const frame = new Uint8Array([0x00, 10, 20, 30]);

    const message = reassembler.push(frame);
    expect(message).not.toBeNull();

    frame[2] = 99;

    expect(Array.from(message ?? [])).toEqual([10, 20, 30]);
  });

  it('resets after malformed fragment and can accept next valid message', () => {
    const reassembler = new Reassembler({ maxMessageBytes: 128 });

    const start = new Uint8Array([0x01, 4, 0, 0, 0, 1, 2, 3]);
    const badEnd = new Uint8Array([0x03, 4, 5, 6]);

    expect(reassembler.push(start)).toBeNull();
    expect(() => reassembler.push(badEnd)).toThrow(/mismatch|overflow/);

    const valid = new Uint8Array([0x00, 9, 8, 7]);
    const done = reassembler.push(valid);

    expect(Array.from(done ?? [])).toEqual([9, 8, 7]);
  });
});
