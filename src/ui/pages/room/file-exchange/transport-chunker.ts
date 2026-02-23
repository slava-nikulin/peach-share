/**
 * Very simple message fragmentation/reassembly for message-oriented channels.
 *
 * Assumptions (MVP):
 * - delivery is ordered & reliable (default WebRTC DataChannel behavior in simple-peer)
 * - no interleaving of different logical messages (enforced by sender queue)
 *
 * Frame format:
 *   SINGLE: [0x00][message...]
 *   START : [0x01][totalLen u32le][payload...]
 *   CONT  : [0x02][payload...]
 *   END   : [0x03][payload...]
 */

const K_SINGLE = 0x00;
const K_START = 0x01;
const K_CONT = 0x02;
const K_END = 0x03;

export type ReassemblerOpts = {
  maxMessageBytes: number;
};

export function* fragmentMessage(message: Uint8Array, maxFrameBytes: number): Iterable<Uint8Array> {
  if (maxFrameBytes < 8) throw new Error('maxFrameBytes too small');

  const singleCap = maxFrameBytes - 1;
  if (message.length <= singleCap) {
    const out = new Uint8Array(1 + message.length);
    out[0] = K_SINGLE;
    out.set(message, 1);
    yield out;
    return;
  }

  const total = message.length;
  const startCap = maxFrameBytes - (1 + 4);
  const contCap = maxFrameBytes - 1;

  if (startCap <= 0 || contCap <= 0) throw new Error('maxFrameBytes too small for headers');

  let off = 0;

  // START
  {
    const take = Math.min(startCap, total - off);
    const out = new Uint8Array(1 + 4 + take);
    out[0] = K_START;
    writeU32LE(out, 1, total);
    out.set(message.subarray(off, off + take), 1 + 4);
    yield out;
    off += take;
  }

  // CONT...
  while (total - off > contCap) {
    const out = new Uint8Array(1 + contCap);
    out[0] = K_CONT;
    out.set(message.subarray(off, off + contCap), 1);
    yield out;
    off += contCap;
  }

  // END
  {
    const rest = total - off;
    const out = new Uint8Array(1 + rest);
    out[0] = K_END;
    out.set(message.subarray(off), 1);
    yield out;
  }
}

export class Reassembler {
  private readonly maxMessageBytes: number;

  private buf: Uint8Array | null = null;
  private total = 0;
  private off = 0;

  constructor(opts: ReassemblerOpts) {
    const { maxMessageBytes } = opts;
    if (!Number.isFinite(maxMessageBytes) || maxMessageBytes <= 0) {
      throw new Error('maxMessageBytes must be a positive number');
    }
    this.maxMessageBytes = Math.floor(maxMessageBytes);
  }

  push(frame: Uint8Array): Uint8Array | null {
    if (frame.length < 1) throw new Error('empty transport frame');

    const kind = frame[0];

    if (kind === K_SINGLE) {
      const payloadLen = frame.length - 1;
      if (payloadLen > this.maxMessageBytes) {
        throw new Error(
          `SINGLE payload exceeds maxMessageBytes=${this.maxMessageBytes} (got ${payloadLen})`,
        );
      }

      // Return a copy to avoid aliasing on reused transport buffers.
      return frame.slice(1);
    }

    if (kind === K_START) {
      if (frame.length < 1 + 4) throw new Error('START frame too short');
      if (this.buf) {
        this.reset();
        throw new Error('Received START while another message is in progress');
      }

      const total = readU32LE(frame, 1);
      const payload = frame.subarray(1 + 4);

      if (total <= 0) throw new Error('Invalid total length');
      if (total > this.maxMessageBytes) {
        throw new Error(`START total exceeds maxMessageBytes=${this.maxMessageBytes} (got ${total})`);
      }
      if (payload.length > total) throw new Error('START payload larger than total');

      this.buf = new Uint8Array(total);
      this.total = total;
      this.off = 0;

      this.buf.set(payload, 0);
      this.off += payload.length;

      // message could theoretically fit into START only (if sender chose so),
      // but our fragmenter always ends with END, so we wait.
      return null;
    }

    if (kind === K_CONT || kind === K_END) {
      if (!this.buf) throw new Error('Received CONT/END without START');
      const payload = frame.subarray(1);

      if (this.off + payload.length > this.total) {
        this.reset();
        throw new Error('Reassembly overflow');
      }

      this.buf.set(payload, this.off);
      this.off += payload.length;

      if (kind === K_END) {
        if (this.off !== this.total) {
          this.reset();
          throw new Error(`Reassembly size mismatch: got ${this.off}, expected ${this.total}`);
        }
        const done = this.buf;
        this.reset();
        return done;
      }

      return null;
    }

    this.reset();
    throw new Error(`Unknown transport frame kind: ${kind}`);
  }

  reset(): void {
    this.buf = null;
    this.total = 0;
    this.off = 0;
  }
}

function readU32LE(u8: Uint8Array, off: number): number {
  return (u8[off] | (u8[off + 1] << 8) | (u8[off + 2] << 16) | (u8[off + 3] << 24)) >>> 0;
}

function writeU32LE(u8: Uint8Array, off: number, v: number): void {
  u8[off] = v & 0xff;
  u8[off + 1] = (v >>> 8) & 0xff;
  u8[off + 2] = (v >>> 16) & 0xff;
  u8[off + 3] = (v >>> 24) & 0xff;
}
