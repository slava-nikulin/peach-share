import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { auth } from '../config/firebase';

let ensureAnonPromise: Promise<string> | null = null;
export function anonAuth(): Promise<string> {
  if (auth.currentUser?.uid) return Promise.resolve(auth.currentUser.uid);
  if (ensureAnonPromise) return ensureAnonPromise;

  ensureAnonPromise = new Promise<string>((resolve, reject) => {
    const unsub = onAuthStateChanged(
      auth,
      (u) => {
        if (u?.uid) {
          unsub();
          resolve(u.uid);
        }
      },
      (err) => {
        unsub();
        reject(err);
      },
    );
    const performSignIn = async (): Promise<void> => {
      try {
        if (!auth.currentUser) {
          await signInAnonymously(auth);
        }
      } catch (e) {
        unsub();
        reject(e);
      }
    };
    void performSignIn();
  }).finally(() => {
    ensureAnonPromise = null;
  });

  return ensureAnonPromise;
}
