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

interface StartDhInput {
  roomId: string;
  role: Role;
  sharedS: string; // base64url 32B
  timeoutMs?: number;
  sasDigits?: number;
  context?: string;
}

interface StartDhDeps {
  db?: Database;
}

interface StartDhResult {
  enc_key: Uint8Array;
  sas: string;
}

class DiffieHellmanHandshake {
  private readonly database: Database;
  private readonly input: StartDhInput;
  private _sessionContext?: SessionContext;
  private _handshake?: HandshakeState;
  private _peerArtifacts?: PeerArtifacts;
  private _derivedKeys?: DerivedKeys;
  private _sas?: string;

  constructor(input: StartDhInput, deps: StartDhDeps) {
    this.input = input;
    this.database = deps.db ?? db;
  }

  public async execute(): Promise<StartDhResult> {
    await this.initializeContext();
    await this.performHandshake();
    await this.publishLocalHandshake();
    await this.collectPeerArtifacts();
    await this.deriveSessionKeys();
    await this.publishMacAndVerify();
    await this.markSuccess();
    await this.computeSas();
    return { enc_key: this.derivedKeys.encKey, sas: this.sas };
  }

  private async initializeContext(): Promise<void> {
    const {
      roomId,
      role,
      sharedS,
      timeoutMs = 20_000,
      sasDigits = 6,
      context = 'default',
    } = this.input;

    const pathId = `rooms/${roomId}/dh`;
    const dhRef = ref(this.database, pathId);
    const meKey: Role = role === 'owner' ? 'owner' : 'guest';
    const peerKey: Role = role === 'owner' ? 'guest' : 'owner';

    const sharedSecret = fromBase64Url(sharedS);
    if (sharedSecret.length !== 32) throw new Error('bad_psk');

    const dhSecret = await hkdf(sharedSecret, null, utf8('dh'), 32);

    this.sessionContext = {
      role,
      dhSecret,
      pathId,
      dhRef,
      meKey,
      peerKey,
      timeoutMs,
      sasDigits,
      context,
    };
  }

  private async performHandshake(): Promise<void> {
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
      'deriveBits',
    ]);
    const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
    const nonce = crypto.getRandomValues(new Uint8Array(16));
    const role = this.role;

    this.handshake = {
      localMsg: pubRaw,
      priv: kp.privateKey,
      nonceA: role === 'owner' ? nonce : null,
      nonceB: role === 'guest' ? nonce : null,
    };
  }

  private async publishLocalHandshake(): Promise<void> {
    const targetRef = child(this.dhRef, this.meKey);
    const nonce = this.getNonceForRole(this.role);

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
          msg_b64: toBase64Url(this.handshake.localMsg),
          nonce_b64: toBase64Url(nonce),
          at: Date.now(),
        };
      },
      { applyLocally: false },
    );
  }

  private async collectPeerArtifacts(): Promise<void> {
    const peer = await this.waitPeerWithTimeout(child(this.dhRef, this.peerKey));
    this.peerArtifacts = peer;
  }

  private async deriveSessionKeys(): Promise<void> {
    const peer = this.peerArtifacts;
    const peerPub = await crypto.subtle.importKey(
      'raw',
      DiffieHellmanHandshake.toArrayBuffer(peer.peerMsg),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );

    const bits = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: peerPub },
      this.handshake.priv,
      256,
    );
    const sharedSecret = new Uint8Array(bits);

    const nonceA = this.role === 'owner' ? this.getNonceForRole(this.role) : peer.peerNonce;
    const nonceB = this.role === 'guest' ? this.getNonceForRole(this.role) : peer.peerNonce;

    const transcript = await sha256(concatBytes(utf8(this.pathId), nonceA, nonceB, utf8('v1')));
    const sessionKey = await hkdf(sharedSecret, this.dhSecret, transcript, 32);

    const [encKey, macKey] = await Promise.all([
      hkdf(sessionKey, null, utf8('enc'), 32),
      hkdf(sessionKey, null, utf8('mac'), 32),
    ]);

    this.derivedKeys = { sessionKey, encKey, macKey, nonceA, nonceB };
  }

  private async publishMacAndVerify(): Promise<void> {
    const label = this.role === 'owner' ? 'A' : 'B';
    const peerLabel = this.role === 'owner' ? 'B' : 'A';
    const nonceA = toBase64Url(this.derivedKeys.nonceA);
    const nonceB = toBase64Url(this.derivedKeys.nonceB);
    const messageBase = `${this.pathId}|${nonceA}|${nonceB}|owner|guest|v1`;

    const macSelf = await hmacSHA256(this.derivedKeys.macKey, ascii(`${label}|${messageBase}`));
    await update(child(this.dhRef, `mac/${this.meKey}`), {
      mac_b64: toBase64Url(macSelf),
      at: Date.now(),
    });

    const macPeer = await this.waitMacWithTimeout(child(this.dhRef, `mac/${this.peerKey}`));

    const macPeerExpected = await hmacSHA256(
      this.derivedKeys.macKey,
      ascii(`${peerLabel}|${messageBase}`),
    );
    if (!bytesEq(macPeer, macPeerExpected)) {
      await update(child(this.dhRef, 'status'), { error: 'mac_mismatch', at: Date.now() });
      throw new Error('mac_mismatch');
    }
  }

  private async markSuccess(): Promise<void> {
    await update(child(this.dhRef, 'status'), { ok: true, at: Date.now() });
  }

  private async computeSas(): Promise<void> {
    const sas = await DiffieHellmanHandshake.makeSas(
      this.derivedKeys.sessionKey,
      this.sessionContext.context,
      this.sessionContext.sasDigits,
    );
    this.sas = sas;
  }

  private waitPeerWithTimeout(targetRef: DatabaseReference): Promise<PeerArtifacts> {
    return new Promise<PeerArtifacts>((resolve, reject) => {
      const timer = setTimeout(() => {
        off(targetRef);
        reject(new Error('peer_timeout'));
      }, this.sessionContext.timeoutMs);

      const unsubscribe = onValue(
        targetRef,
        (snap) => {
          const value = snap.val();
          if (value?.msg_b64 && value?.nonce_b64) {
            clearTimeout(timer);
            resolve({
              peerMsg: fromBase64Url(value.msg_b64),
              peerNonce: fromBase64Url(value.nonce_b64),
            });
            unsubscribe();
          }
        },
        (err) => {
          clearTimeout(timer);
          off(targetRef);
          reject(err);
        },
      );
    });
  }

  private waitMacWithTimeout(targetRef: DatabaseReference): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        off(targetRef);
        reject(new Error('peer_mac_timeout'));
      }, this.sessionContext.timeoutMs);

      const unsubscribe = onValue(
        targetRef,
        (snap) => {
          const value = snap.val();
          if (value?.mac_b64) {
            clearTimeout(timer);
            resolve(fromBase64Url(value.mac_b64));
            unsubscribe();
          }
        },
        (err) => {
          clearTimeout(timer);
          off(targetRef);
          reject(err);
        },
      );
    });
  }

  private getNonceForRole(role: Role): Uint8Array {
    const nonce = role === 'owner' ? this.handshake.nonceA : this.handshake.nonceB;
    if (!nonce) throw new Error('nonce not initialised for role');
    return nonce;
  }

  private static async makeSas(SK: Uint8Array, context: string, digits: number): Promise<string> {
    const info = concatBytes(utf8('sas'), utf8(context));
    const okm = await hkdf(SK, null, info, 4);
    const n = (okm[0] << 24) | (okm[1] << 16) | (okm[2] << 8) | okm[3];
    const pos = (n >>> 0) % 10 ** digits;
    return pos.toString().padStart(digits, '0');
  }

  private static toArrayBuffer(u8: Uint8Array): ArrayBuffer {
    if (
      u8.buffer instanceof ArrayBuffer &&
      u8.byteOffset === 0 &&
      u8.byteLength === u8.buffer.byteLength
    ) {
      return u8.buffer;
    }
    return u8.slice().buffer;
  }

  private get sessionContext(): SessionContext {
    if (!this._sessionContext) throw new Error('session context not initialised');
    return this._sessionContext;
  }

  private set sessionContext(value: SessionContext) {
    this._sessionContext = value;
  }

  private get handshake(): HandshakeState {
    if (!this._handshake) throw new Error('handshake state not initialised');
    return this._handshake;
  }

  private set handshake(value: HandshakeState) {
    this._handshake = value;
  }

  private get peerArtifacts(): PeerArtifacts {
    if (!this._peerArtifacts) throw new Error('peer artifacts not collected');
    return this._peerArtifacts;
  }

  private set peerArtifacts(value: PeerArtifacts) {
    this._peerArtifacts = value;
  }

  private get derivedKeys(): DerivedKeys {
    if (!this._derivedKeys) throw new Error('keys not derived');
    return this._derivedKeys;
  }

  private set derivedKeys(value: DerivedKeys) {
    this._derivedKeys = value;
  }

  private get sas(): string {
    if (!this._sas) throw new Error('sas not computed');
    return this._sas;
  }

  private set sas(value: string) {
    this._sas = value;
  }

  private get dhRef(): DatabaseReference {
    return this.sessionContext.dhRef;
  }

  private get meKey(): Role {
    return this.sessionContext.meKey;
  }

  private get peerKey(): Role {
    return this.sessionContext.peerKey;
  }

  private get role(): Role {
    return this.sessionContext.role;
  }

  private get pathId(): string {
    return this.sessionContext.pathId;
  }

  private get dhSecret(): Uint8Array {
    return this.sessionContext.dhSecret;
  }
}

export async function startDH(input: StartDhInput, deps: StartDhDeps = {}): Promise<StartDhResult> {
  const handshake = new DiffieHellmanHandshake(input, deps);
  return handshake.execute();
}
