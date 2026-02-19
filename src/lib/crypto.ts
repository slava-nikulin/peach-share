import { gcmsiv } from '@noble/ciphers/aes.js';
import { bytesToUtf8, equalBytes, managedNonce, utf8ToBytes } from '@noble/ciphers/utils.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { base64ToUint8Array, concatUint8Arrays, uint8ArrayToBase64 } from 'uint8array-extras';

const te = new TextEncoder();

type WebRtcSignalKind = 'offer' | 'answer';

/**
 * mac_key = SHA-512("CPaceMac" || sid || ISK)
 * returns 64 bytes
 */
export function deriveMacKeyBytes(sid: Uint8Array, isk: Uint8Array): Uint8Array {
  const data = concatUint8Arrays([te.encode('CPaceMac'), sid, isk]);
  return sha512(data); // Uint8Array(64)
}

/**
 * HMAC-SHA256(key, msg)
 * returns 32 bytes
 */
export function hmacSha256(keyBytes: Uint8Array, msg: Uint8Array): Uint8Array {
  return hmac(sha256, keyBytes, msg); // Uint8Array(32)
}

/**
 * Constant-time verify for HMAC-SHA256
 */
export function hmacSha256Verify(key: Uint8Array, msg: Uint8Array, tag: Uint8Array): boolean {
  const expected = hmacSha256(key, msg);
  return equalBytes(expected, tag);
}
/**
 * Derive dedicated AEAD key for WebRTC signaling from ISK using HKDF-SHA256.
 * 32 bytes key (256-bit).
 */
function deriveWebRtcSignalKey(isk: Uint8Array, roomId: string): Uint8Array {
  const salt = te.encode(`rooms:webrtc-signal-key:v1:${roomId}`);
  const info = te.encode('webrtc-signal:gcmsiv');
  return hkdf(sha256, isk, salt, info, 32);
}

/**
 * AAD binds ciphertext to (roomId, kind) so it can't be swapped across fields/rooms.
 */
function webrtcSignalAad(roomId: string, kind: WebRtcSignalKind): Uint8Array {
  return te.encode(`rooms:webrtc-signal-aad:v1:${roomId}:${kind}`);
}

/**
 * Encrypt WebRTC signal JSON (string) into an opaque base64url string.
 * Format: "w1:" + b64url( managedNonce(gcmsiv).encrypt(utf8(signal)) )
 * managedNonce auto-prepends nonce to ciphertext; decrypt auto-reads it.
 */
export function encryptWebRtcSignal(
  isk: Uint8Array,
  roomId: string,
  kind: WebRtcSignalKind,
  signalJson: string,
): string {
  const key = deriveWebRtcSignalKey(isk, roomId);
  const aad = webrtcSignalAad(roomId, kind);

  const aead = managedNonce(gcmsiv)(key, aad);
  const sealed = aead.encrypt(utf8ToBytes(signalJson)); // nonce is embedded
  return `w1:${uint8ArrayToBase64(sealed, { urlSafe: true })}`;
}

/**
 * Decrypt opaque base64url string back to WebRTC signal JSON (string).
 */
export function decryptWebRtcSignal(
  isk: Uint8Array,
  roomId: string,
  kind: WebRtcSignalKind,
  boxed: string,
): string {
  if (typeof boxed !== 'string' || !boxed.startsWith('w1:')) {
    throw new Error('Invalid boxed WebRTC signal: missing prefix');
  }

  const sealed = base64ToUint8Array(boxed.slice(3));

  const key = deriveWebRtcSignalKey(isk, roomId);
  const aad = webrtcSignalAad(roomId, kind);

  const aead = managedNonce(gcmsiv)(key, aad);

  let pt: Uint8Array;
  try {
    pt = aead.decrypt(sealed);
  } catch {
    throw new Error('Failed to decrypt WebRTC signal (tampered or wrong key)');
  }

  return bytesToUtf8(pt);
}
