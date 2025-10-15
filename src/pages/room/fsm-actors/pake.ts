import type { DatabaseReference } from 'firebase/database';
import { child, off, onValue, ref, runTransaction, update } from 'firebase/database';
import {
  ascii,
  bytesEq,
  devDummyPakeEngine,
  fromBase64Url,
  hkdf,
  hmacSHA256,
  type PakeEngine,
  sha256,
  toBase64Url,
  utf8,
} from '../../../lib/crypto';
import { db } from '../config/firebase';
import type { Role } from '../types';

type RoleKey = 'owner' | 'guest';

interface SessionContext {
  role: Role;
  sharedSecret: Uint8Array;
  pathId: string;
  pakeRef: DatabaseReference;
  meKey: RoleKey;
  peerKey: RoleKey;
  timeoutMs: number;
  engine: PakeEngine;
  sasDigits: number;
  context: string;
}

interface HandshakeState {
  localMsg: Uint8Array;
  state: unknown;
  nonceA: Uint8Array | null;
  nonceB: Uint8Array | null;
}

interface PeerArtifacts {
  peerMsg: Uint8Array;
  peerNonce: Uint8Array;
}

interface DerivedKeys {
  sessionKey: Uint8Array;
  encKey: Uint8Array;
  macKey: Uint8Array;
  nonceA: Uint8Array;
  nonceB: Uint8Array;
}

export async function startPakeSession(input: {
  roomId: string;
  role: Role;
  sharedS: string;
  timeoutMs?: number;
  engine?: PakeEngine;
  sasDigits?: number;
  context?: string;
}): Promise<{ enc_key: Uint8Array; sas: string }> {
  const ctx = buildSessionContext(input);
  const handshake = await initiateHandshake(ctx);
  await publishLocalHandshake(ctx, handshake);
  const peer = await waitPeerArtifacts(ctx);
  const keys = await deriveSessionKeys(ctx, handshake, peer);
  await publishMacAndVerify(ctx, keys);
  await update(child(ctx.pakeRef, 'status'), { ok: true, at: Date.now() });
  const sas = await makeSAS(keys.sessionKey, ctx.context, ctx.sasDigits);
  return { enc_key: keys.encKey, sas };
}

function buildSessionContext(input: {
  roomId: string;
  role: Role;
  sharedS: string;
  timeoutMs?: number;
  engine?: PakeEngine;
  sasDigits?: number;
  context?: string;
}): SessionContext {
  const {
    roomId,
    role,
    sharedS,
    timeoutMs = 20_000,
    engine = devDummyPakeEngine,
    sasDigits = 6,
    context = 'default',
  } = input;
  const pathId = `rooms/${roomId}/pake`;
  const pakeRef = ref(db, pathId);
  const meKey: RoleKey = role === 'owner' ? 'owner' : 'guest';
  const peerKey: RoleKey = role === 'owner' ? 'guest' : 'owner';
  const sharedSecret = fromBase64Url(sharedS);
  return {
    role,
    sharedSecret,
    pathId,
    pakeRef,
    meKey,
    peerKey,
    timeoutMs,
    engine,
    sasDigits,
    context,
  };
}

async function initiateHandshake(ctx: SessionContext): Promise<HandshakeState> {
  const pakeSecret = await hkdf(ctx.sharedSecret, null, utf8('pake'), 32);
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  const { localMsg, state } = await ctx.engine.start({ role: ctx.role, pakeSecret });
  return {
    localMsg,
    state,
    nonceA: ctx.role === 'owner' ? nonce : null,
    nonceB: ctx.role === 'guest' ? nonce : null,
  };
}

async function publishLocalHandshake(
  ctx: SessionContext,
  handshake: HandshakeState,
): Promise<void> {
  const targetRef = child(ctx.pakeRef, ctx.meKey);
  const nonce = getNonceForRole(handshake, ctx.role);
  interface PakeHandshakeRecord {
    msg_b64: string;
    nonce_b64: string;
    at: number;
  }
  await runTransaction(
    targetRef,
    (current: PakeHandshakeRecord | null) => {
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
  return waitPeerWithTimeout({ ref: child(ctx.pakeRef, ctx.peerKey), timeoutMs: ctx.timeoutMs });
}

async function deriveSessionKeys(
  ctx: SessionContext,
  handshake: HandshakeState,
  peer: PeerArtifacts,
): Promise<DerivedKeys> {
  const { spakeOut } = await ctx.engine.finish({ state: handshake.state, peerMsg: peer.peerMsg });
  const nonceA = ctx.role === 'owner' ? getNonceForRole(handshake, ctx.role) : peer.peerNonce;
  const nonceB = ctx.role === 'guest' ? getNonceForRole(handshake, ctx.role) : peer.peerNonce;
  const ikmSK = concatBytes(spakeOut, ctx.sharedSecret, nonceA, nonceB, utf8(ctx.pathId));
  const sessionKey = await hkdf(ikmSK, null, utf8('SK'), 32);
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
  const messageBase = `${ctx.pathId}|${nonceA}|${nonceB}`;
  const macSelf = await hmacSHA256(keys.macKey, ascii(`${label}|${messageBase}`));
  await update(child(ctx.pakeRef, `mac/${ctx.meKey}`), {
    mac_b64: toBase64Url(macSelf),
    at: Date.now(),
  });
  const macPeer = await waitMacWithTimeout({
    ref: child(ctx.pakeRef, `mac/${ctx.peerKey}`),
    timeoutMs: ctx.timeoutMs,
  });
  const macPeerExpected = await hmacSHA256(keys.macKey, ascii(`${peerLabel}|${messageBase}`));
  if (!bytesEq(macPeer, macPeerExpected)) {
    await update(child(ctx.pakeRef, 'status'), { error: 'mac_mismatch', at: Date.now() });
    throw new Error('mac_mismatch');
  }
}

function getNonceForRole(handshake: HandshakeState, role: Role): Uint8Array {
  const nonce = role === 'owner' ? handshake.nonceA : handshake.nonceB;
  if (!nonce) {
    throw new Error('nonce not initialised for role');
  }
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
          off(r);
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
          off(r);
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
  const h = await sha256(concatBytes(SK, utf8(context)));
  // Берем 4 байта как uint32 и выводим как десятичный код нужной длины
  const n = (h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3];
  const pos = (n >>> 0) % 10 ** digits;
  return pos.toString().padStart(digits, '0');
}

function concatBytes(...arrs: Uint8Array[]): Uint8Array {
  const len = arrs.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}
