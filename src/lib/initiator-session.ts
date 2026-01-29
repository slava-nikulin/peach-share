import { toBase36 } from './codec';
import type { BeaconPort, CpacePort, CryptoPort, RtdbPort, TimerPort } from './ports';

interface InitiatorDeps {
  authUid: string;
  rtdb: RtdbPort;
  prsCode: string; // короткий код для PAKE (например, 4–6 символов)
  beacon: BeaconPort;
  crypto: CryptoPort;
  cpace: CpacePort;
  timeoutMs: number; // общий таймаут шага
  timer: TimerPort;
  // rtc: RtcPort;
  // suite: CPaceSuiteDesc;
  // kdf: KdfPort;
  // log?: Logger;
}

export class InitiatorSession {
  private readonly deps: InitiatorDeps;

  constructor(deps: InitiatorDeps) {
    this.deps = deps;
  }

  // основные RTDB-пути
  private pUserLobby() {
    return `/usr/${this.deps.authUid}/current_lobby`;
  }
  private pUserRoom() {
    return `/usr/${this.deps.authUid}/current_room`;
  }
  private pLobby(lobbyId: string) {
    return `/lobby/${lobbyId}`;
  }
  private pRoom(roomId: string) {
    return `/room/${roomId}`;
  }

  // вспомогательное
  private abortCtl?: AbortController;

  async start(): Promise<void> {
    // const { log = console } = this.deps;
    this.abortCtl = new AbortController();
    const signal = this.abortCtl.signal;

    // 1) Лобби: вычислить lobbyId (маяк+Argon2id) и поставить тикет
    const lobbyId = await this.computeLobbyId();
    // const created = await this.deps.rtdb.setIfAbsent(this.pUserLobby(), lobbyId);
    // if (!created) throw new Error('lobby ticket already exists');

    // ждать, пока триггер создаст объект лобби (идемпотентно)
    await this.waitUntil(
      async () => {
        const meta = await this.deps.rtdb.get<{ meta?: unknown }>(`${this.pLobby(lobbyId)}`);
        return Boolean(meta);
      },
      signal,
      'lobby meta',
    );

    // 2) PAKE: m1 → ждать m2 → SK
    // const { isk, sid } = await this.runPake(lobbyId, signal);

    // 3) Ключи/roomId из SK
    // const { roomId, aeadKey } = await this.deriveRoomAndKeys(isk, sid, lobbyId);

    // 4) Комната: тикет → ожидание создания триггером
    // const roomCreated = await this.deps.rtdb.setIfAbsent(this.pUserRoom(), roomId);
    // if (!roomCreated) throw new Error('room ticket already exists');

    // await this.waitUntil(
    //   async () => {
    //     const meta = await this.deps.rtdb.get<{ meta?: unknown }>(`${this.pRoom(roomId)}`);
    //     return Boolean(meta);
    //   },
    //   signal,
    //   'room meta',
    // );

    // 5) WebRTC SDP/ICE: шифрованный сигналинг
    // await this.runWebRtcSignalExchange(roomId, aeadKey, signal);

    // 6) Очистка тикетов (логику удаления самих объектов делает ваш триггер)
    // await this.safeDel(this.pUserLobby());
    // await this.safeDel(this.pUserRoom());

    // log.info('initiator: connected & cleaned');
  }

  abort(reason?: string) {
    // this.deps.log?.warn('initiator abort', reason);
    this.abortCtl?.abort();
  }

  // --- Шаги ---

  private async computeLobbyId(): Promise<string> {
    const { beacon, crypto, prsCode } = this.deps;
    const { pepper } = await beacon.getPepperForCurrentEpoch();
    const h = await crypto.argon2id(prsCode, pepper, 64, 0.5);
    // 10–12 символов Base32/36; здесь возьмём 10 байт → 16 символов base32 (или 8–10 символов base36)
    return toBase36(h.slice(0, 6)); // ≤ 36^8; если хочешь ровно 6 — сужай, но помни про коллизии
  }

  // private async runPake(
  //   lobbyId: string,
  //   signal: AbortSignal,
  // ): Promise<{ isk: Uint8Array; sid?: Uint8Array }> {
  //   const { cpace, rtdb, suite, prsCode, timer, log = console } = this.deps;

  //   const sess = cpace.newSession({
  //     prs: new TextEncoder().encode(prsCode),
  //     suite,
  //     role: 'initiator',
  //     mode: 'initiator-responder',
  //   });
  //   const m1 = await sess.start();
  //   if (!m1) throw new Error('CPace initiator must produce m1');

  //   // записать m1 в лобби (base64url)
  //   await rtdb.set(`${this.pLobby(lobbyId)}/pake/m1`, encodeB64u(m1.payload));

  //   // ждать m2
  //   const m2payload = await this.waitValue<string>(
  //     `${this.pLobby(lobbyId)}/pake/m2`,
  //     signal,
  //     'pake m2',
  //   );
  //   const m2: CPaceMessage = { type: 'msg', payload: decodeB64u(m2payload) };

  //   // принять m2 (ответа от инициатора нет) и завершить
  //   await sess.receive(m2);
  //   const isk = sess.exportISK();
  //   log.info('CPace done', { isk_len: isk.length });
  //   return { isk, sid: sess.sidOutput };
  // }

  // private async deriveRoomAndKeys(isk: Uint8Array, sid: Uint8Array | undefined, lobbyId: string) {
  //   const { kdf, crypto } = this.deps;
  //   const salt = sid ?? new Uint8Array(32); // нули, если sid нет
  //   const prk = await kdf.hkdf('prk', isk, salt, 32); // deriveBits в WebCrypto делает Extract+Expand; тут — упрощённо
  //   const roomIdBytes = await kdf.hkdf(`webrtc-room-id|${lobbyId}`, prk, undefined, 16); // 128 бит
  //   const aeadKeyRaw = await kdf.hkdf('webrtc-sig-aead', prk, undefined, 32);
  //   const roomId = toBase32(roomIdBytes); // 26 символов Base32 (RFC4648/Crockford — согласуй с правилами)
  //   const aeadKey = await crypto.importAeadKey(aeadKeyRaw);
  //   return { roomId, aeadKey };
  // }

  // private async runWebRtcSignalExchange(roomId: string, aeadKey: CryptoKey, signal: AbortSignal) {
  //   const { rtc, rtdb, crypto, timer, log = console } = this.deps;

  //   await rtc.createPeer();
  //   rtc.localIce(async (cand) => {
  //     const seq = Date.now(); // проще всего; лучше держать инкремент
  //     const nonce = makeNonce(seq);
  //     const aad = makeAad(roomId, 'initiator', seq);
  //     const body = new TextEncoder().encode(JSON.stringify(cand));
  //     const ct = await crypto.aeadSeal(aeadKey, nonce, aad, body);
  //     await rtdb.set(`${this.pRoom(roomId)}/sig/ice/initiator/${seq}`, encodeB64u(pack(nonce, ct)));
  //   });

  //   // OFFER
  //   const offer = await rtc.setLocalOffer();
  //   {
  //     const seq = 1;
  //     const nonce = makeNonce(seq);
  //     const aad = makeAad(roomId, 'initiator', seq);
  //     const body = new TextEncoder().encode(JSON.stringify(offer));
  //     const ct = await crypto.aeadSeal(aeadKey, nonce, aad, body);
  //     await rtdb.set(`${this.pRoom(roomId)}/sig/offer`, encodeB64u(pack(nonce, ct)));
  //   }

  //   // ANSWER
  //   const ansPacked = await this.waitValue<string>(
  //     `${this.pRoom(roomId)}/sig/answer`,
  //     signal,
  //     'answer',
  //   );
  //   {
  //     const { nonce, ct } = unpack(decodeB64u(ansPacked));
  //     const aad = makeAad(roomId, 'responder', 1);
  //     const pt = await crypto.aeadOpen(aeadKey, nonce, aad, ct);
  //     const answer = JSON.parse(new TextDecoder().decode(pt)) as RTCSessionDescriptionInit;
  //     await rtc.applyRemoteAnswer(answer);
  //   }

  //   // remote ICE
  //   const abortIce = new AbortController();
  //   this.deps.rtdb.watch<Record<string, string>>(
  //     `${this.pRoom(roomId)}/sig/ice/responder`,
  //     async (obj) => {
  //       if (!obj) return;
  //       for (const [seqStr, packed] of Object.entries(obj)) {
  //         const seq = Number(seqStr);
  //         const { nonce, ct } = unpack(decodeB64u(packed));
  //         const aad = makeAad(roomId, 'responder', seq);
  //         const pt = await crypto.aeadOpen(aeadKey, nonce, aad, ct);
  //         await rtc.addRemoteIce(JSON.parse(new TextDecoder().decode(pt)));
  //       }
  //     },
  //     abortIce.signal,
  //   );

  //   // дождаться соединения (или таймаута)
  //   await this.waitUntil(
  //     async () => {
  //       let done = false;
  //       rtc.onConnected(() => {
  //         done = true;
  //       });
  //       await this.deps.timer.wait(200, signal);
  //       return done;
  //     },
  //     signal,
  //     'rtc connected',
  //   );

  //   abortIce.abort();
  //   log.info('WebRTC connected');
  // }

  // --- Утилиты ---

  private async waitUntil(pred: () => Promise<boolean>, signal: AbortSignal, label: string) {
    const deadline = this.deps.timer.now() + this.deps.timeoutMs;
    while (!signal.aborted) {
      if (await pred()) return;
      if (this.deps.timer.now() > deadline) throw new Error(`timeout: ${label}`);
      await this.deps.timer.wait(120, signal);
    }
    throw new Error(`aborted: ${label}`);
  }

  //   private async waitValue<T>(path: string, signal: AbortSignal, label: string): Promise<T> {
  //     let val: T | null = await this.deps.rtdb.get<T>(path);
  //     if (val != null) return val;
  //     return new Promise<T>((resolve, reject) => {
  //       const ac = new AbortController();
  //       const onAbort = () => {
  //         ac.abort();
  //         reject(new Error(`timeout/abort: ${label}`));
  //       };
  //       const timer = setTimeout(onAbort, this.deps.timeoutMs);
  //       this.deps.rtdb.watch<T>(
  //         path,
  //         (v) => {
  //           if (v != null) {
  //             clearTimeout(timer);
  //             ac.abort();
  //             resolve(v as T);
  //           }
  //         },
  //         ac.signal,
  //       );
  //       signal.addEventListener('abort', onAbort, { once: true });
  //     });
  //   }

  //   private async safeDel(path: string) {
  //     try {
  //       await this.deps.rtdb.del(path);
  //     } catch {}
  //   }
}

// --- примитивные кодеки/вспомогалки (схематично) ---
// function toBase32(b: Uint8Array): string {
//   /*…*/ return '';
// }
// function toBase36(b: Uint8Array): string {
//   /*…*/ return '';
// }
// function encodeB64u(b: Uint8Array): string {
//   /*…*/ return '';
// }
// function decodeB64u(s: string): Uint8Array {
//   /*…*/ return new Uint8Array();
// }
// function makeNonce(seq: number): Uint8Array {
//   /* 12 байт из seq+рандома */ return new Uint8Array(12);
// }
// function makeAad(roomId: string, role: 'initiator' | 'responder', seq: number): Uint8Array {
//   return new TextEncoder().encode(`${roomId}|${role}|${seq}`);
// }
// function pack(nonce: Uint8Array, ct: Uint8Array): Uint8Array {
//   /* nonce || ct */ return new Uint8Array(nonce.length + ct.length);
// }
// function unpack(buf: Uint8Array): { nonce: Uint8Array; ct: Uint8Array } {
//   /*…*/ return { nonce: new Uint8Array(12), ct: buf };
// }
