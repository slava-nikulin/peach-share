import { type Auth, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { firebaseEnv } from '../config/firebase';

let authReadyP: Promise<string> | null = null;
const auth: Auth = firebaseEnv.auth;
let cachedUid: string | null = auth.currentUser?.uid ?? null;
let startedAnonSignIn = false;

export function anonAuth(timeoutMs: number = 15000): Promise<string> {
  if (cachedUid || auth.currentUser?.uid) {
    const uid = cachedUid ?? auth.currentUser?.uid;
    if (!uid) {
      return Promise.reject(new Error('no_auth_uid'));
    }
    cachedUid = uid;
    return Promise.resolve(uid);
  }
  if (authReadyP) return authReadyP;

  let resolveWrap!: (uid: string) => void;
  let rejectWrap!: (e: unknown) => void;
  authReadyP = new Promise<string>((res, rej) => {
    resolveWrap = res;
    rejectWrap = rej;
  });

  const timer = setTimeout(() => {
    const err = new Error('auth_timeout');
    rejectWrap(err);
    authReadyP = null;
    startedAnonSignIn = false;
  }, timeoutMs);

  const unsub = onAuthStateChanged(
    auth,
    (u) => {
      if (u?.uid) {
        cachedUid = u.uid;
        clearTimeout(timer);
        unsub();
        // закрепляем «липкий» resolved
        const uid = u.uid;
        authReadyP = Promise.resolve(uid);
        resolveWrap(uid);
      }
    },
    (err) => {
      clearTimeout(timer);
      unsub();
      authReadyP = null;
      startedAnonSignIn = false;
      rejectWrap(err);
    },
  );

  if (!auth.currentUser && !startedAnonSignIn) {
    startedAnonSignIn = true;
    signInAnonymously(auth).catch((e) => {
      clearTimeout(timer);
      unsub();
      authReadyP = null;
      startedAnonSignIn = false;
      rejectWrap(e);
    });
  }

  return authReadyP;
}

export function resetAnonAuthCache(): void {
  cachedUid = null;
  authReadyP = null;
  startedAnonSignIn = false;
}
