import type { Database, DatabaseReference } from 'firebase/database';
import { child, off, onValue, ref, runTransaction, update } from 'firebase/database';
import {
  ascii,
  bytesEq,
  concatBytes,
  fromBase64Url,
  hkdf,
  hmacSHA256,
  sha256,
  toBase64Url,
  utf8,
} from '../../../lib/crypto';
import { db } from '../config/firebase';
import type { Role } from '../types';

interface SessionContext {
  role: Role;
  dhSecret: Uint8Array;
  pathId: string;
  dhRef: DatabaseReference;
  meKey: Role;
  peerKey: Role;
  timeoutMs: number;
  sasDigits: number;
  context: string;
}

interface HandshakeState {
  localMsg: Uint8Array; // публичный ключ ECDH (RAW, 65 байт)
  priv: CryptoKey; // приватный ключ ECDH (non-extractable)
  nonceA: Uint8Array | null;
  nonceB: Uint8Array | null;
}

interface PeerArtifacts {
  peerMsg: Uint8Array; // публичный ключ пира (RAW)
  peerNonce: Uint8Array;
}

interface DerivedKeys {
  sessionKey: Uint8Array; // SK
  encKey: Uint8Array;
  macKey: Uint8Array;
  nonceA: Uint8Array;
  nonceB: Uint8Array;
}

interface StartDhDeps {
  db?: Database;
}

export async function startDH(
  input: {
    roomId: string;
    role: Role;
    sharedS: string; // base64url 32B
    timeoutMs?: number;
    sasDigits?: number;
    context?: string;
  },
  deps: StartDhDeps = {},
): Promise<{ enc_key: Uint8Array; sas: string }> {
  const ctx = await buildSessionContext(input, deps.db ?? db);
  const handshake = await initiateHandshake(ctx);
  await publishLocalHandshake(ctx, handshake);
  const peer = await waitPeerArtifacts(ctx);
  const keys = await deriveSessionKeys(ctx, handshake, peer);
  await publishMacAndVerify(ctx, keys);
  await update(child(ctx.dhRef, 'status'), { ok: true, at: Date.now() });
  const sas = await makeSAS(keys.sessionKey, ctx.context, ctx.sasDigits);
  return { enc_key: keys.encKey, sas };
}

async function buildSessionContext(
  input: {
    roomId: string;
    role: Role;
    sharedS: string;
    timeoutMs?: number;
    sasDigits?: number;
    context?: string;
  },
  database: Database,
): Promise<SessionContext> {
  const { roomId, role, sharedS, timeoutMs = 20_000, sasDigits = 6, context = 'default' } = input;

  const pathId = `rooms/${roomId}/dh`;
  const dhRef = ref(database, pathId);
  const meKey: Role = role === 'owner' ? 'owner' : 'guest';
  const peerKey: Role = role === 'owner' ? 'guest' : 'owner';

  const sharedSecret = fromBase64Url(sharedS);
  if (sharedSecret.length !== 32) throw new Error('bad_psk');

  const dhSecret = await hkdf(sharedSecret, null, utf8('dh'), 32);

  return {
    role,
    dhSecret: dhSecret,
    pathId,
    dhRef: dhRef,
    meKey,
    peerKey,
    timeoutMs,
    sasDigits,
    context,
  };
}

async function initiateHandshake(ctx: SessionContext): Promise<HandshakeState> {
  // Эфемерный ECDH на P-256
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveBits',
  ]);
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)); // 65B

  const nonce = crypto.getRandomValues(new Uint8Array(16));

  return {
    localMsg: pubRaw,
    priv: kp.privateKey,
    nonceA: ctx.role === 'owner' ? nonce : null,
    nonceB: ctx.role === 'guest' ? nonce : null,
  };
}

async function publishLocalHandshake(
  ctx: SessionContext,
  handshake: HandshakeState,
): Promise<void> {
  const targetRef = child(ctx.dhRef, ctx.meKey);
  const nonce = getNonceForRole(handshake, ctx.role);
  interface DhHandshakeRecord {
    msg_b64: string;
    nonce_b64: string;
    at: number;
  }
  await runTransaction(
    targetRef,
    (current: DhHandshakeRecord | null) => {
      if (current) return current;
      return {
        msg_b64: toBase64Url(handshake.localMsg),
        nonce_b64: toBase64Url(nonce),
        at: Date.now(),
      };
    },
    { applyLocally: false },
  );
}

async function waitPeerArtifacts(ctx: SessionContext): Promise<PeerArtifacts> {
  return waitPeerWithTimeout({ ref: child(ctx.dhRef, ctx.peerKey), timeoutMs: ctx.timeoutMs });
}

async function deriveSessionKeys(
  ctx: SessionContext,
  handshake: HandshakeState,
  peer: PeerArtifacts,
): Promise<DerivedKeys> {
  // Импорт публичного ключа пира
  const peerPub = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(peer.peerMsg),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  // Общий секрет K (32 байта)
  const bits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerPub },
    handshake.priv,
    256,
  );
  const K = new Uint8Array(bits);

  const nonceA = ctx.role === 'owner' ? getNonceForRole(handshake, ctx.role) : peer.peerNonce;
  const nonceB = ctx.role === 'guest' ? getNonceForRole(handshake, ctx.role) : peer.peerNonce;

  // Transcript + ключевой граф
  const transcript = await sha256(concatBytes(utf8(ctx.pathId), nonceA, nonceB, utf8('v1')));
  const sessionKey = await hkdf(K, ctx.dhSecret, transcript, 32);

  const [encKey, macKey] = await Promise.all([
    hkdf(sessionKey, null, utf8('enc'), 32),
    hkdf(sessionKey, null, utf8('mac'), 32),
  ]);

  return { sessionKey, encKey, macKey, nonceA, nonceB };
}

async function publishMacAndVerify(ctx: SessionContext, keys: DerivedKeys): Promise<void> {
  const label = ctx.role === 'owner' ? 'A' : 'B';
  const peerLabel = ctx.role === 'owner' ? 'B' : 'A';
  const nonceA = toBase64Url(keys.nonceA);
  const nonceB = toBase64Url(keys.nonceB);
  const messageBase = `${ctx.pathId}|${nonceA}|${nonceB}|owner|guest|v1`;

  const macSelf = await hmacSHA256(keys.macKey, ascii(`${label}|${messageBase}`));
  await update(child(ctx.dhRef, `mac/${ctx.meKey}`), {
    mac_b64: toBase64Url(macSelf),
    at: Date.now(),
  });

  const macPeer = await waitMacWithTimeout({
    ref: child(ctx.dhRef, `mac/${ctx.peerKey}`),
    timeoutMs: ctx.timeoutMs,
  });

  const macPeerExpected = await hmacSHA256(keys.macKey, ascii(`${peerLabel}|${messageBase}`));
  if (!bytesEq(macPeer, macPeerExpected)) {
    await update(child(ctx.dhRef, 'status'), { error: 'mac_mismatch', at: Date.now() });
    throw new Error('mac_mismatch');
  }
}

function getNonceForRole(handshake: HandshakeState, role: Role): Uint8Array {
  const nonce = role === 'owner' ? handshake.nonceA : handshake.nonceB;
  if (!nonce) throw new Error('nonce not initialised for role');
  return nonce;
}

async function waitPeerWithTimeout(args: { ref: DatabaseReference; timeoutMs: number }): Promise<{
  peerMsg: Uint8Array;
  peerNonce: Uint8Array;
}> {
  const { ref: r, timeoutMs } = args;
  return new Promise<{ peerMsg: Uint8Array; peerNonce: Uint8Array }>((resolve, reject) => {
    const t = setTimeout(() => {
      off(r);
      reject(new Error('peer_timeout'));
    }, timeoutMs);
    const unsub = onValue(
      r,
      (snap) => {
        const v = snap.val();
        if (v?.msg_b64 && v?.nonce_b64) {
          clearTimeout(t);
          resolve({
            peerMsg: fromBase64Url(v.msg_b64),
            peerNonce: fromBase64Url(v.nonce_b64),
          });
          unsub();
        }
      },
      (err) => {
        clearTimeout(t);
        off(r);
        reject(err);
      },
    );
  });
}

async function waitMacWithTimeout(args: {
  ref: DatabaseReference;
  timeoutMs: number;
}): Promise<Uint8Array> {
  const { ref: r, timeoutMs } = args;
  return new Promise<Uint8Array>((resolve, reject) => {
    const t = setTimeout(() => {
      off(r);
      reject(new Error('peer_mac_timeout'));
    }, timeoutMs);
    const unsub = onValue(
      r,
      (snap) => {
        const v = snap.val();
        if (v?.mac_b64) {
          clearTimeout(t);
          resolve(fromBase64Url(v.mac_b64));
          unsub();
        }
      },
      (err) => {
        clearTimeout(t);
        off(r);
        reject(err);
      },
    );
  });
}

async function makeSAS(SK: Uint8Array, context: string, digits: number): Promise<string> {
  const info = concatBytes(utf8('sas'), utf8(context));
  const okm = await hkdf(SK, null, info, 4);
  const n = (okm[0] << 24) | (okm[1] << 16) | (okm[2] << 8) | okm[3];
  const pos = (n >>> 0) % 10 ** digits;
  return pos.toString().padStart(digits, '0');
}

// WebCrypto требует ArrayBuffer (не SharedArrayBuffer)
function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  if (
    u8.buffer instanceof ArrayBuffer &&
    u8.byteOffset === 0 &&
    u8.byteLength === u8.buffer.byteLength
  ) {
    return u8.buffer;
  }
  return u8.slice().buffer;
}
