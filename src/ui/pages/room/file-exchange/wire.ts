import { base64ToUint8Array, uint8ArrayToBase64 } from 'uint8array-extras';

export type Wire =
  | { k: 'control'; bytes: Uint8Array }
  | { k: 'data'; transferId16: Uint8Array; seq: number; eof: boolean; payload: Uint8Array };

const KIND_CONTROL = 1;
const KIND_DATA = 2;

const TRANSFER_ID_BYTES = 16;
export const DATA_WIRE_HEADER_BYTES = 1 + TRANSFER_ID_BYTES + 4 + 1;

// CONTROL wire: [1][control-bytes...]
export function encodeControlWire(controlBytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + controlBytes.length);
  out[0] = KIND_CONTROL;
  out.set(controlBytes, 1);
  return out;
}

// DATA wire: [2][transferId16:16][seq:u32le:4][flags:1][payload...]
export function encodeDataWire(params: {
  transferId16: Uint8Array; // 16 bytes
  seq: number;
  eof: boolean;
  payload: Uint8Array;
}): Uint8Array {
  const { transferId16, seq, eof, payload } = params;
  assertTransferId16(transferId16);

  if (!Number.isInteger(seq) || seq < 0 || seq > 0xffff_ffff) {
    throw new Error(`seq must be uint32 (got ${seq})`);
  }

  const out = new Uint8Array(DATA_WIRE_HEADER_BYTES + payload.length);
  out[0] = KIND_DATA;
  out.set(transferId16, 1);
  writeU32LE(out, 1 + TRANSFER_ID_BYTES, seq);
  out[DATA_WIRE_HEADER_BYTES - 1] = eof ? 1 : 0;
  out.set(payload, DATA_WIRE_HEADER_BYTES);
  return out;
}

export function decodeWire(message: Uint8Array): Wire {
  if (message.length < 1) throw new Error('empty wire message');

  const kind = message[0];

  if (kind === KIND_CONTROL) {
    // Copy to avoid exposing mutable view into transport buffers.
    return { k: 'control', bytes: message.slice(1) };
  }

  if (kind === KIND_DATA) {
    if (message.length < DATA_WIRE_HEADER_BYTES) {
      throw new Error(`data wire message too short: ${message.length}`);
    }

    return {
      k: 'data',
      transferId16: message.slice(1, 1 + TRANSFER_ID_BYTES),
      seq: readU32LE(message, 1 + TRANSFER_ID_BYTES),
      eof: (message[DATA_WIRE_HEADER_BYTES - 1] & 1) === 1,
      // Copy to avoid aliasing in async processing pipelines.
      payload: message.slice(DATA_WIRE_HEADER_BYTES),
    };
  }

  throw new Error(`unknown wire kind: ${kind}`);
}

export function newTransferId16(): Uint8Array {
  return newId16();
}

export function newId16(): Uint8Array {
  const u8 = new Uint8Array(TRANSFER_ID_BYTES);
  crypto.getRandomValues(u8);
  return u8;
}

export function bytes16ToB64u(u8: Uint8Array): string {
  assertTransferId16(u8);
  return uint8ArrayToBase64(u8, { urlSafe: true });
}

export function b64uToBytes16(s: string): Uint8Array {
  const out = base64ToUint8Array(s);
  assertTransferId16(out);
  return out;
}

export function newTransferId(): { transferId: string; transferId16: Uint8Array } {
  const transferId16 = newId16();
  return { transferId: bytes16ToB64u(transferId16), transferId16 };
}

export function transferIdFrom16(transferId16: Uint8Array): string {
  return bytes16ToB64u(transferId16);
}

export function transferIdTo16(transferId: string): Uint8Array {
  return b64uToBytes16(transferId);
}

function assertTransferId16(id: Uint8Array): void {
  if (id.length !== TRANSFER_ID_BYTES) {
    throw new Error(`transferId16 must be ${TRANSFER_ID_BYTES} bytes`);
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
