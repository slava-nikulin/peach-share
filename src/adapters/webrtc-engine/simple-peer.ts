import Peer, { type SignalData } from 'simple-peer';
import type { P2pChannel } from '../../bll/ports/p2p-channel';
import type { WebRtcPort, WebRtcRole, WebRtcSessionId, WebRtcSignal } from '../../bll/ports/webrtc';
import { SimplePeerChannel } from './simple-peer-channel';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
  settled: boolean;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const d: Deferred<T> = {
    promise: new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    }),
    resolve: (v) => {
      if (d.settled) return;
      d.settled = true;
      resolve(v);
    },
    reject: (e) => {
      if (d.settled) return;
      d.settled = true;
      reject(e);
    },
    settled: false,
  };
  return d;
}

function toWire(data: SignalData): WebRtcSignal {
  return JSON.stringify(data);
}

function fromWire(s: WebRtcSignal): SignalData {
  try {
    return JSON.parse(s) as SignalData;
  } catch (e) {
    throw new Error(`Invalid WebRtcSignal JSON: ${String(e)}`);
  }
}

function withTimeout<T>(
  p: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        onTimeout();
      } finally {
        reject(new Error(message));
      }
    }, timeoutMs);
  });

  // Важное: прикрепляем обработчик, чтобы поздний reject не выстрелил как unhandled.
  void p.catch(() => {});

  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

type Session = {
  role: WebRtcRole;
  peer: Peer.Instance;
  offer?: Deferred<WebRtcSignal>; // only initiator
  connected?: Deferred<void>; // after acceptAnswer/generateAnswer
};

type SimplePeerEngineOpts = {
  rtcConfig?: RTCConfiguration;
  wrtc?: any; // тип можно уточнить под @avahq/wrtc
};

export class SimplePeerEngine implements WebRtcPort {
  private readonly sessions = new Map<WebRtcSessionId, Session>();

  constructor(private readonly opts: SimplePeerEngineOpts = {}) {}

  newSession(role: WebRtcRole, rtcConfig?: RTCConfiguration): WebRtcSessionId {
    const sid = this.genId();
    const peer = new Peer({
      initiator: role === 'initiator',
      trickle: false,
      config: rtcConfig ?? this.opts.rtcConfig,
      wrtc: this.opts.wrtc,
    });

    const s: Session = { role, peer };

    // Инициатор: offer появляется сразу (важно слушать signal "немедленно")
    if (role === 'initiator') {
      s.offer = deferred<WebRtcSignal>();
      void s.offer.promise.catch(() => {});
      peer.once('signal', (data: SignalData) => s.offer?.resolve(toWire(data)));
    }

    // Единый lifecycle
    peer.once('close', () => this.finalize(sid, new Error('peer closed')));
    peer.once('error', (err: unknown) => this.finalize(sid, err));

    this.sessions.set(sid, s);
    return sid;
  }

  // initiator
  async generateOffer(sid: WebRtcSessionId): Promise<WebRtcSignal> {
    const s = this.must(sid);
    if (s.role !== 'initiator') throw new Error('generateOffer: session role is not initiator');
    if (!s.offer) throw new Error('generateOffer: offer is not initialized');

    return s.offer.promise;
  }

  // initiator
  acceptAnswer(sid: WebRtcSessionId, answer: WebRtcSignal): void {
    const s = this.must(sid);
    if (s.role !== 'initiator') throw new Error('acceptAnswer: session role is not initiator');

    this.ensureConnectedDeferred(s);

    // signal может кинуть (например, если peer уже destroyed) :contentReference[oaicite:7]{index=7}
    try {
      s.peer.signal(fromWire(answer));
    } catch (e) {
      this.finalize(sid, e);
      throw e;
    }
  }

  // responder
  generateAnswer(sid: WebRtcSessionId, offer: WebRtcSignal): Promise<WebRtcSignal> {
    const s = this.must(sid);
    if (s.role !== 'responder') throw new Error('generateAnswer: session role is not responder');

    this.ensureConnectedDeferred(s);

    const ans = deferred<WebRtcSignal>();
    void ans.promise.catch(() => {});

    s.peer.once('signal', (data: SignalData) => ans.resolve(toWire(data)));
    s.peer.once('error', (err: unknown) => ans.reject(err));

    try {
      s.peer.signal(fromWire(offer));
    } catch (e) {
      ans.reject(e);
      this.finalize(sid, e);
    }

    return ans.promise;
  }

  // common
  async waitConnected(sid: WebRtcSessionId, timeoutMs: number): Promise<P2pChannel> {
    const s = this.must(sid);
    if (!s.connected) throw new Error('waitConnected: call acceptAnswer/generateAnswer first');

    await withTimeout(s.connected.promise, timeoutMs, () => s.peer.destroy(), 'connect timeout');

    return new SimplePeerChannel(s.peer);
  }

  destroy(sid: WebRtcSessionId): void {
    const s = this.sessions.get(sid);
    if (!s) return;
    s.peer.destroy();
    this.finalize(sid, new Error('destroyed'));
  }

  private ensureConnectedDeferred(s: Session): void {
    if (s.connected) return;

    s.connected = deferred<void>();
    void s.connected.promise.catch(() => {});

    // connect/data channel ready :contentReference[oaicite:8]{index=8}
    s.peer.once('connect', () => s.connected?.resolve());

    // если закрыли до коннекта — это ошибка сценария
    s.peer.once('close', () => s.connected?.reject(new Error('closed before connect')));
    // error обработается finalize(), но на всякий случай:
    s.peer.once('error', (err: unknown) => s.connected?.reject(err));
  }

  private finalize(sid: WebRtcSessionId, err: unknown): void {
    const s = this.sessions.get(sid);
    if (!s) return;

    s.offer?.reject(err);
    s.connected?.reject(err);

    this.sessions.delete(sid);
  }

  private must(id: WebRtcSessionId): Session {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`Unknown or destroyed WebRTC session: ${id}`);
    return s;
  }

  private genId(): string {
    return `ws_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  }
}
