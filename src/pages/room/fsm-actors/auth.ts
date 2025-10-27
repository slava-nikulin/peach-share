import { type Auth, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { getRoomFirebaseEnv, type RoomFirebaseEnvironment } from '../config/firebase';

export interface AuthenticatorDeps {
  env?: RoomFirebaseEnvironment;
}

export class Authenticator {
  private readonly env: RoomFirebaseEnvironment;
  private readonly auth: Auth;
  private authReadyP: Promise<string> | null = null;
  private cachedUid: string | null;
  private startedAnonSignIn = false;

  constructor(deps: AuthenticatorDeps = {}) {
    this.env = deps.env ?? getRoomFirebaseEnv();
    this.auth = this.env.auth;
    this.cachedUid = this.auth.currentUser?.uid ?? null;
  }

  public reset(): void {
    this.cachedUid = null;
    this.authReadyP = null;
    this.startedAnonSignIn = false;
  }

  public anonAuth(timeoutMs: number = 15_000): Promise<string> {
    const existingUid = this.cachedUid ?? this.auth.currentUser?.uid ?? null;
    if (existingUid) {
      this.cachedUid = existingUid;
      return Promise.resolve(existingUid);
    }

    if (this.authReadyP) return this.authReadyP;

    let resolveWrap!: (uid: string) => void;
    let rejectWrap!: (error: unknown) => void;
    const pending = new Promise<string>((resolve, reject) => {
      resolveWrap = resolve;
      rejectWrap = reject;
    });
    this.authReadyP = pending;

    const timer = setTimeout(() => {
      const error = new Error('auth_timeout');
      this.authReadyP = null;
      this.startedAnonSignIn = false;
      rejectWrap(error);
    }, timeoutMs);

    const unsubscribe = onAuthStateChanged(
      this.auth,
      (user) => {
        if (user?.uid) {
          this.cachedUid = user.uid;
          clearTimeout(timer);
          unsubscribe();
          const uid = user.uid;
          this.authReadyP = Promise.resolve(uid);
          this.startedAnonSignIn = false;
          resolveWrap(uid);
        }
      },
      (error) => {
        clearTimeout(timer);
        unsubscribe();
        this.authReadyP = null;
        this.startedAnonSignIn = false;
        rejectWrap(error);
      },
    );

    if (!this.auth.currentUser && !this.startedAnonSignIn) {
      this.startedAnonSignIn = true;
      signInAnonymously(this.auth).catch((error) => {
        clearTimeout(timer);
        unsubscribe();
        this.authReadyP = null;
        this.startedAnonSignIn = false;
        rejectWrap(error);
      });
    }

    return pending;
  }
}

export const authenticator: Authenticator = new Authenticator();
