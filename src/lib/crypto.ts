const te: TextEncoder = new TextEncoder();

export function genSecret32(): Uint8Array {
  const s = new Uint8Array(32);
  crypto.getRandomValues(s);
  return s;
}

export async function hkdfPathId(
  secret: Uint8Array,
  info: string = 'path',
  bits: number = 128,
): Promise<string> {
  // base key for HKDF
  const baseKey = await crypto.subtle.importKey(
    'raw',
    secret.buffer instanceof ArrayBuffer
      ? new Uint8Array(secret.buffer, secret.byteOffset, secret.byteLength)
      : new Uint8Array(new ArrayBuffer(secret.byteLength)),
    { name: 'HKDF' },
    false,
    ['deriveBits', 'deriveKey'],
  );
  // derive bits for path id
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: te.encode(info),
    },
    baseKey,
    bits,
  );
  return toBase64Url(new Uint8Array(derived));
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
