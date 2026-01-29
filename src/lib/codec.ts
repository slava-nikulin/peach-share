import basex from 'base-x';

const BASE36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ' as const;
var bs36 = basex(BASE36);

export function toBase36(bytes: Uint8Array): string {
  return bs36.encode(bytes);
}

export function fromBase36(encoded: string): Uint8Array {
  return bs36.decode(encoded);
}
