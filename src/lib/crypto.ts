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
  // компактное base64url без '='
  let b64 = btoa(String.fromCharCode(...bytes));
  b64 = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return b64;
}

export function secretToBase64Url(secret: Uint8Array): string {
  return toBase64Url(secret);
}
