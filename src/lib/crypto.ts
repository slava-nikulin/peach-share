import type { Role } from '../pages/room/types';

const te: TextEncoder = new TextEncoder();

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = view;
  if (buffer instanceof ArrayBuffer) {
    if (byteOffset === 0 && byteLength === buffer.byteLength) {
      return buffer;
    }
    return buffer.slice(byteOffset, byteOffset + byteLength);
  }
  // SharedArrayBuffer or other exotic buffers – copy into a regular ArrayBuffer.
  return view.slice().buffer;
}

export function genSecret32(): Uint8Array {
  const s = new Uint8Array(32);
  crypto.getRandomValues(s);
  return s;
}

export function bytesEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let v = 0;
  for (let i = 0; i < a.length; i++) v |= a[i] ^ b[i];
  return v === 0;
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const h = await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes));
  return new Uint8Array(h);
}

export async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array | null,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', toArrayBuffer(ikm), 'HKDF', false, [
    'deriveBits',
  ]);
  const params: HkdfParams = {
    name: 'HKDF',
    hash: 'SHA-256',
    salt: salt ? toArrayBuffer(salt) : new ArrayBuffer(0),
    info: toArrayBuffer(info),
  };
  const bits = await crypto.subtle.deriveBits(params, key, length * 8);
  return new Uint8Array(bits);
}

export async function hmacSHA256(keyBytes: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(keyBytes),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, toArrayBuffer(msg));
  return new Uint8Array(sig);
}

export async function hkdfPathId(
  secret: Uint8Array,
  info: string = 'path',
  bits: number = 128,
): Promise<string> {
  if (bits % 8 !== 0) throw new Error('hkdfPathId: bits must be divisible by 8');
  const derived = await hkdf(secret, new Uint8Array(0), te.encode(info), bits / 8);
  return toBase64Url(derived);
}

export function toBase64Url(bytes: Uint8Array): string {
  const binaryString = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  const b64 = btoa(binaryString);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function fromBase64Url(base64Url: string): Uint8Array {
  const standardBase64 = base64Url
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(base64Url.length + ((4 - (base64Url.length % 4)) % 4), '=');

  const binaryString = atob(standardBase64);

  return Uint8Array.from(binaryString, (c) => c.charCodeAt(0));
}

export interface PakeEngine {
  start(params: { role: Role; pakeSecret: Uint8Array }): Promise<{
    localMsg: Uint8Array; // X или Y
    state: unknown; // внутренний state PAKE
  }>;
  // Завершение, когда получено сообщение контрагента.
  finish(params: { state: unknown; peerMsg: Uint8Array }): Promise<{
    spakeOut: Uint8Array; // общий секрет из PAKE (например, Z)
  }>;
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function ascii(s: string): Uint8Array {
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code > 127) {
      throw new Error(`Non-ASCII character detected: '${s[i]}'`);
    }
    bytes[i] = code;
  }
  return bytes;
}
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export const devDummyPakeEngine: PakeEngine = {
  async start({ pakeSecret }: { role: Role; pakeSecret: Uint8Array }): Promise<{
    localMsg: Uint8Array;
    state: unknown;
  }> {
    const localMsg = crypto.getRandomValues(new Uint8Array(32));
    const state = { pakeSecret, localMsg } as unknown;
    return { localMsg, state };
  },
  async finish({ state, peerMsg }: { state: unknown; peerMsg: Uint8Array }): Promise<{
    spakeOut: Uint8Array;
  }> {
    const { pakeSecret, localMsg } = state as { pakeSecret: Uint8Array; localMsg: Uint8Array };
    const [a, b] = compareBytes(localMsg, peerMsg) <= 0 ? [localMsg, peerMsg] : [peerMsg, localMsg];
    const ikm = concatBytes(pakeSecret, a, b, utf8('stub'));
    const spakeOut = await hkdf(ikm, /*salt*/ null, utf8('spake-out'), 32);
    return { spakeOut };
  },
};
