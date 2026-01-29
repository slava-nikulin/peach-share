// RTDB обертка: только то, что нужно
export interface RtdbPort {
  setIfAbsent(path: string, value: unknown): Promise<boolean>; // true если создали
  set(path: string, value: unknown): Promise<void>;
  del(path: string): Promise<void>;
  get<T>(path: string): Promise<T | null>;
  watch<T>(path: string, onValue: (v: T | null) => void, signal: AbortSignal): void;
}

// CPace обертка (поверх @cpace-ts)
export interface CpacePort {
  newSession(opts: {
    prs: Uint8Array;
    suite: CPaceSuiteDesc;
    role: 'initiator';
    mode: 'initiator-responder';
    ada?: Uint8Array;
    adb?: Uint8Array;
    ci?: Uint8Array;
    sid?: Uint8Array;
  }): {
    start(): Promise<CPaceMessage | undefined>;
    receive(msg: CPaceMessage): Promise<CPaceMessage | undefined>;
    exportISK(): Uint8Array; // SK/ISK
    sidOutput?: Uint8Array;
  };
}

export interface CryptoPort {
  aeadSeal(
    key: CryptoKey,
    nonce: Uint8Array,
    aad: Uint8Array,
    plaintext: Uint8Array,
  ): Promise<Uint8Array>;
  aeadOpen(
    key: CryptoKey,
    nonce: Uint8Array,
    aad: Uint8Array,
    ciphertext: Uint8Array,
  ): Promise<Uint8Array>;
  importAeadKey(raw: Uint8Array): Promise<CryptoKey>;
  hkdf(info: string, ikm: Uint8Array, salt?: Uint8Array, len?: number): Promise<Uint8Array>;
  argon2id(
    codeUtf8: string,
    salt: Uint8Array,
    memMiB: number,
    timeSec: number,
  ): Promise<Uint8Array>;
}

export interface RtcPort {
  createPeer(): Promise<void>;
  localIce(onIce: (cand: RTCIceCandidateInit) => void): void;
  setLocalOffer(): Promise<RTCSessionDescriptionInit>; // возвращает offer
  applyRemoteAnswer(ans: RTCSessionDescriptionInit): Promise<void>;
  addRemoteIce(cand: RTCIceCandidateInit): Promise<void>;
  onConnected(cb: () => void): void;
}

export interface BeaconPort {
  // вернуть соль-маяк якорного окна (Solana-и пр.) и metadata окна (для записи в meta при желании)
  getPepperForCurrentEpoch(): Promise<{ pepper: Uint8Array; epoch: number }>;
}

export interface TimerPort {
  wait(ms: number, signal: AbortSignal): Promise<void>;
  now(): number;
}

export interface Logger {
  info(...a: unknown[]): void;
  warn(...a: unknown[]): void;
  error(...a: unknown[]): void;
}
