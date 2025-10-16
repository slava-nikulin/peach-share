import {
  child,
  type DatabaseReference,
  type DataSnapshot,
  onChildAdded,
  onValue,
  push,
  set,
} from 'firebase/database';
import type { Role } from '../pages/room/types';
import { fromBase64Url, toBase64Url } from './crypto';

// ---------- AES-GCM helpers ----------
const te: TextEncoder = new TextEncoder();
const td: TextDecoder = new TextDecoder();

function toAB(u8: Uint8Array): ArrayBuffer {
  if (u8.buffer instanceof ArrayBuffer) {
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  }
  return u8.slice().buffer;
}

export async function importAesGcmKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', toAB(raw), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

function randIv(bytes: number = 12): Uint8Array {
  const iv = new Uint8Array(bytes);
  crypto.getRandomValues(iv);
  return iv;
}

/** Шифрование: возвращаем шифртекст и использованный IV */
export async function aeadEncrypt(
  key: CryptoKey,
  plain: Uint8Array,
): Promise<{ cipher: Uint8Array; iv: Uint8Array }> {
  const iv = randIv(); // 12 байт под GCM
  const buf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toAB(iv), tagLength: 128 },
    key,
    toAB(plain),
  );
  return { cipher: new Uint8Array(buf), iv };
}

/** Дешифрование: подаем ровно тот же IV */
export async function aeadDecrypt(
  key: CryptoKey,
  cipher: Uint8Array,
  iv: Uint8Array,
): Promise<Uint8Array> {
  const buf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toAB(iv), tagLength: 128 },
    key,
    toAB(cipher),
  );
  return new Uint8Array(buf);
}

/** Удобные обертки для JSON */
export async function encJson(
  key: CryptoKey,
  obj: unknown,
): Promise<{ msg_b64: string; nonce_b64: string }> {
  const { cipher, iv } = await aeadEncrypt(key, te.encode(JSON.stringify(obj)));
  return { msg_b64: toBase64Url(cipher), nonce_b64: toBase64Url(iv) };
}

export async function decJson<T>(key: CryptoKey, msgB64: string, nonceB64: string): Promise<T> {
  const cipher = fromBase64Url(msgB64);
  const iv = fromBase64Url(nonceB64);
  const plain = await aeadDecrypt(key, cipher, iv);
  return JSON.parse(td.decode(plain)) as T;
}

// ---------- RTDB paths ----------
function other(role: Role): Role {
  return role === 'owner' ? 'guest' : 'owner';
}

export interface SigPaths {
  offerRef: DatabaseReference;
  answerRef: DatabaseReference;
  theirOfferRef: DatabaseReference;
  theirAnswerRef: DatabaseReference;
  myCandidatesRef: DatabaseReference;
  theirCandidatesRef: DatabaseReference;
}

export function sigPaths(args: { roomRef: DatabaseReference; role: Role }): SigPaths {
  const base = child(args.roomRef, `webrtc`);
  return {
    offerRef: child(base, `offer/${args.role}`),
    answerRef: child(base, `answer/${args.role}`), // ответ, написанный этой стороной
    theirOfferRef: child(base, `offer/${other(args.role)}`),
    theirAnswerRef: child(base, `answer/${other(args.role)}`), // ответ оппонента
    myCandidatesRef: child(base, `candidates/${args.role}`),
    theirCandidatesRef: child(base, `candidates/${other(args.role)}`),
  };
}

// ---------- signaling primitives ----------
export async function writeEncrypted(
  refNode: DatabaseReference,
  key: CryptoKey,
  payload: unknown,
): Promise<void> {
  const pkt = await encJson(key, payload);
  await set(refNode, pkt);
}

export function waitEncrypted<T>(
  refNode: DatabaseReference,
  key: CryptoKey,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      unsub();
      reject(new Error('peer_timeout'));
    }, timeoutMs);

    const handler = async (snap: DataSnapshot) => {
      const v = snap.val();
      if (!(v?.msg_b64 && v?.nonce_b64)) return;
      try {
        const obj = await decJson<T>(key, v.msg_b64, v.nonce_b64);
        clearTimeout(t);
        unsub();
        resolve(obj);
      } catch {
        // битый/чужой пакет — продолжаем слушать
      }
    };

    const errorHandler = (err: unknown) => {
      clearTimeout(t);
      unsub();
      reject(err);
    };

    const unsub = onValue(refNode, handler, errorHandler);
  });
}

export async function pushEncrypted(
  refList: DatabaseReference,
  key: CryptoKey,
  payload: unknown,
): Promise<void> {
  const pkt = await encJson(key, payload);
  await set(push(refList), pkt);
}

export function onEachEncrypted<T>(
  refList: DatabaseReference,
  key: CryptoKey,
  handler: (obj: T) => void,
): () => void {
  const unsub = onChildAdded(refList, async (snap) => {
    const v = snap.val();
    if (v?.msg_b64 && v?.nonce_b64) {
      try {
        const obj = await decJson<T>(key, v.msg_b64, v.nonce_b64);
        handler(obj);
      } catch {
        /* ignore bad packet */
      }
    }
  });
  return () => unsub();
}
