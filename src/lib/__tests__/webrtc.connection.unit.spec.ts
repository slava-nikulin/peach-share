import type { DatabaseReference } from 'firebase/database';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '../../pages/room/types';
import { WebRTCConnection } from '../webrtc';

type OnEachEncryptedMockFn = ReturnType<
  typeof vi.fn<(src: unknown, key: unknown, cb: (cand: RTCIceCandidateInit) => void) => () => void>
>;

interface HoistedMocks {
  candidateCallbacks: Array<(cand: RTCIceCandidateInit) => void>;
  stopOnEachEncryptedSpy: ReturnType<typeof vi.fn>;
  onEachEncryptedMock: OnEachEncryptedMockFn;
}

const getMocks: () => HoistedMocks = vi.hoisted(() => {
  const candidateCallbacks: HoistedMocks['candidateCallbacks'] = [];
  const stopOnEachEncryptedSpy: HoistedMocks['stopOnEachEncryptedSpy'] = vi.fn();
  const onEachEncryptedMock: HoistedMocks['onEachEncryptedMock'] = vi.fn<
    (src: unknown, key: unknown, cb: (cand: RTCIceCandidateInit) => void) => () => void
  >((_, __, cb) => {
    candidateCallbacks.push(cb);
    return stopOnEachEncryptedSpy as unknown as () => void;
  });

  const factory = (): HoistedMocks => ({
    candidateCallbacks,
    stopOnEachEncryptedSpy,
    onEachEncryptedMock,
  });

  return factory;
});

const { candidateCallbacks, stopOnEachEncryptedSpy, onEachEncryptedMock }: HoistedMocks =
  getMocks();

vi.mock('../crypto-webrtc', () => ({
  importAesGcmKey: vi.fn(),
  pushEncrypted: vi.fn(),
  sigPaths: vi.fn(),
  waitEncrypted: vi.fn(),
  writeEncrypted: vi.fn(),
  onEachEncrypted: getMocks().onEachEncryptedMock,
}));

const CONN_FAILED_REGEX = /conn_failed/;
const ICE_FAILED_REGEX = /ice_failed/;

class FakeRTCIceCandidate {
  public readonly candidate: string;

  public constructor(init: RTCIceCandidateInit) {
    this.candidate = init.candidate ?? '';
    Object.assign(this, init);
  }
}

beforeAll(() => {
  (globalThis as unknown as { RTCIceCandidate: typeof FakeRTCIceCandidate }).RTCIceCandidate =
    FakeRTCIceCandidate as unknown as typeof RTCIceCandidate;
});

const getSubscribeRemoteCandidates = (): ((
  pc: RTCPeerConnection,
  key: CryptoKey,
  src: unknown,
) => () => void) => Reflect.get(WebRTCConnection, 'subscribeRemoteCandidates');

const getCreateReadyPromise = (): ((opts: {
  pc: RTCPeerConnection;
  channel: RTCDataChannel;
  timeoutMs?: number;
  signal?: AbortSignal;
  onFail?: () => void;
}) => Promise<void>) => Reflect.get(WebRTCConnection, 'createReadyPromise');

const getCreateChannelPromise = (): ((
  pc: RTCPeerConnection,
  role: Role,
  label: string,
) => Promise<RTCDataChannel>) => Reflect.get(WebRTCConnection, 'createChannelPromise');

class MockEventTarget {
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  public addEventListener(type: string, handler: (...args: unknown[]) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(handler);
  }

  public removeEventListener(type: string, handler: (...args: unknown[]) => void): void {
    this.listeners.get(type)?.delete(handler);
  }

  protected emit(type: string, ...args: unknown[]): void {
    const handlers = this.listeners.get(type);
    if (!handlers) return;
    for (const handler of Array.from(handlers)) {
      handler(...args);
    }
  }

  public listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

class MockDataChannel extends MockEventTarget {
  public binaryType: BinaryType = 'blob';
  public readonly bufferedAmount = 0;
  public bufferedAmountLowThreshold = 0;
  public id: number | null = 0;
  public label: string;
  public readonly negotiated = false;
  public readonly ordered = true;
  public readonly protocol = '';
  public readyState: RTCDataChannelState;
  public readonly maxPacketLifeTime: number | null = null;
  public readonly maxRetransmits: number | null = null;

  public constructor(label: string = 'file-data') {
    super();
    this.label = label;
    this.readyState = 'connecting';
  }

  public close(): void {}

  public send(): void {}

  public setReadyState(state: RTCDataChannelState): void {
    (this as { readyState: RTCDataChannelState }).readyState = state;
  }

  public triggerOpen(): void {
    this.setReadyState('open');
    this.emit('open');
  }

  public fire(eventType: string, payload: unknown): void {
    this.emit(eventType, payload);
  }

  public onbufferedamountlow: ((this: RTCDataChannel, ev: Event) => void) | null = null;
  public onclose: ((this: RTCDataChannel, ev: Event) => void) | null = null;
  public onerror: ((this: RTCDataChannel, ev: RTCErrorEvent) => void) | null = null;
  public onmessage: ((this: RTCDataChannel, ev: MessageEvent) => void) | null = null;
  public onopen: ((this: RTCDataChannel, ev: Event) => void) | null = null;
}

class MockRTCPeerConnection extends MockEventTarget {
  public connectionState: RTCPeerConnectionState = 'new';
  public iceConnectionState: RTCIceConnectionState = 'new';
  public signalingState: RTCSignalingState = 'have-local-offer';
  public remoteDescription: RTCSessionDescription | null = null;
  public addIceCandidate = vi.fn(() => Promise.resolve());
  public createDataChannel = vi.fn((label: string) => new MockDataChannel(label));
  public setRemoteDescription = vi.fn(
    async (desc?: RTCSessionDescriptionInit | RTCSessionDescription) => {
      this.remoteDescription = (desc ?? {}) as RTCSessionDescription;
    },
  );

  public triggerConnectionState(state: RTCPeerConnectionState): void {
    this.connectionState = state;
    this.emit('connectionstatechange');
  }

  public triggerIceConnectionState(state: RTCIceConnectionState): void {
    this.iceConnectionState = state;
    this.emit('iceconnectionstatechange');
  }

  public triggerSignalingState(state: RTCSignalingState): void {
    this.signalingState = state;
    this.emit('signalingstatechange');
  }

  public emitDataChannel(channel: RTCDataChannel): void {
    this.emit('datachannel', { channel } as RTCDataChannelEvent);
  }
}

describe('subscribeRemoteCandidates', () => {
  beforeEach(() => {
    candidateCallbacks.length = 0;
    stopOnEachEncryptedSpy.mockReset();
    onEachEncryptedMock.mockClear();
  });

  it('removes listeners and stops subscription on cleanup', () => {
    const pc = new MockRTCPeerConnection();
    const originalSetRemoteDescription = pc.setRemoteDescription;
    const stop = getSubscribeRemoteCandidates()(
      pc as unknown as RTCPeerConnection,
      {} as CryptoKey,
      {},
    );
    expect(pc.listenerCount('signalingstatechange')).toBe(1);
    expect(pc.setRemoteDescription).not.toBe(originalSetRemoteDescription);

    stop();

    expect(pc.listenerCount('signalingstatechange')).toBe(0);
    expect(stopOnEachEncryptedSpy).toHaveBeenCalledTimes(1);
    expect(pc.setRemoteDescription).toBe(originalSetRemoteDescription);
  });

  it('flushes queued candidates immediately when remote description already set', async () => {
    const pc = new MockRTCPeerConnection();
    pc.remoteDescription = {} as RTCSessionDescription;
    const addSpy = vi.spyOn(pc, 'addIceCandidate');
    const stop = getSubscribeRemoteCandidates()(
      pc as unknown as RTCPeerConnection,
      {} as CryptoKey,
      {},
    );

    const candidate = { candidate: 'cand1' } as RTCIceCandidateInit;
    const callback = candidateCallbacks[0];
    expect(callback).toBeDefined();
    if (!callback) throw new Error('candidate callback missing');
    callback(candidate);

    await Promise.resolve();
    expect(addSpy).toHaveBeenCalledTimes(1);
    stop();
  });

  it('does not flush queued candidates until remote description becomes available', async () => {
    const pc = new MockRTCPeerConnection();
    const addSpy = vi.spyOn(pc, 'addIceCandidate');
    const stop = getSubscribeRemoteCandidates()(
      pc as unknown as RTCPeerConnection,
      {} as CryptoKey,
      {},
    );

    const callback = candidateCallbacks[0];
    expect(callback).toBeDefined();
    if (!callback) throw new Error('candidate callback missing');
    callback({ candidate: 'queued' } as RTCIceCandidateInit);

    pc.triggerSignalingState('stable');
    await Promise.resolve();
    expect(addSpy).not.toHaveBeenCalled();

    pc.remoteDescription = {} as RTCSessionDescription;
    pc.triggerSignalingState('stable');
    await Promise.resolve();
    expect(addSpy).toHaveBeenCalledTimes(1);
    stop();
  });

  it('flushes queued candidates once setRemoteDescription resolves', async () => {
    const pc = new MockRTCPeerConnection();
    const addSpy = vi.spyOn(pc, 'addIceCandidate');
    const stop = getSubscribeRemoteCandidates()(
      pc as unknown as RTCPeerConnection,
      {} as CryptoKey,
      {},
    );
    const callback = candidateCallbacks[0];
    expect(callback).toBeDefined();
    if (!callback) throw new Error('candidate callback missing');
    callback({ candidate: 'queued' } as RTCIceCandidateInit);

    await pc.setRemoteDescription({ type: 'answer', sdp: 'test' } as RTCSessionDescriptionInit);
    await Promise.resolve();
    expect(addSpy).toHaveBeenCalledTimes(1);
    stop();
  });

  it('enforces queue bound before remote description', async () => {
    const pc = new MockRTCPeerConnection();
    const addSpy = vi.spyOn(pc, 'addIceCandidate');
    const stop = getSubscribeRemoteCandidates()(
      pc as unknown as RTCPeerConnection,
      {} as CryptoKey,
      {},
    );

    const callback = candidateCallbacks[0];
    expect(callback).toBeDefined();
    if (!callback) throw new Error('candidate callback missing');
    for (let i = 0; i < 600; i += 1) {
      callback({ candidate: `cand-${i}` } as RTCIceCandidateInit);
    }

    pc.remoteDescription = {} as RTCSessionDescription;
    pc.triggerSignalingState('stable');

    await Promise.resolve();
    expect(addSpy).toHaveBeenCalledTimes(500);
    stop();
  });

  it('logs warning when addIceCandidate rejects', async () => {
    const pc = new MockRTCPeerConnection();
    const error = new Error('boom');
    pc.addIceCandidate.mockImplementation(() => Promise.reject(error));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const stop = getSubscribeRemoteCandidates()(
      pc as unknown as RTCPeerConnection,
      {} as CryptoKey,
      {},
    );
    const callback = candidateCallbacks[0];
    expect(callback).toBeDefined();
    if (!callback) throw new Error('candidate callback missing');
    pc.remoteDescription = {} as RTCSessionDescription;
    pc.triggerSignalingState('stable');
    callback({ candidate: 'cand' } as RTCIceCandidateInit);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(warnSpy).toHaveBeenCalledWith('addIceCandidate failed', error);
    warnSpy.mockRestore();
    stop();
  });
});

describe('createReadyPromise', () => {
  let pc: MockRTCPeerConnection;
  let channel: MockDataChannel;
  let createReadyPromise: ReturnType<typeof getCreateReadyPromise>;

  beforeEach(() => {
    pc = new MockRTCPeerConnection();
    channel = new MockDataChannel();
    createReadyPromise = getCreateReadyPromise();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves when channel opens', async () => {
    const promise = createReadyPromise({
      pc: pc as unknown as RTCPeerConnection,
      channel: channel as unknown as RTCDataChannel,
    });
    channel.triggerOpen();
    await expect(promise).resolves.toBeUndefined();
  });

  it('resolves on connectionstate connected', async () => {
    const promise = createReadyPromise({
      pc: pc as unknown as RTCPeerConnection,
      channel: channel as unknown as RTCDataChannel,
    });
    pc.triggerConnectionState('connected');
    await expect(promise).resolves.toBeUndefined();
  });

  it('resolves on iceConnectionState connected', async () => {
    const promise = createReadyPromise({
      pc: pc as unknown as RTCPeerConnection,
      channel: channel as unknown as RTCDataChannel,
    });
    pc.triggerIceConnectionState('connected');
    await expect(promise).resolves.toBeUndefined();
  });

  it('rejects on connection failure states', async () => {
    const onFail = vi.fn();
    const promise = createReadyPromise({
      pc: pc as unknown as RTCPeerConnection,
      channel: channel as unknown as RTCDataChannel,
      onFail,
    });
    pc.triggerConnectionState('failed');
    await expect(promise).rejects.toThrow(CONN_FAILED_REGEX);
    expect(onFail).toHaveBeenCalledTimes(1);
  });

  it('rejects on ice failure', async () => {
    const onFail = vi.fn();
    const promise = createReadyPromise({
      pc: pc as unknown as RTCPeerConnection,
      channel: channel as unknown as RTCDataChannel,
      onFail,
    });
    pc.triggerIceConnectionState('failed');
    await expect(promise).rejects.toThrow(ICE_FAILED_REGEX);
    expect(onFail).toHaveBeenCalledTimes(1);
  });

  it('rejects on timeout', async () => {
    vi.useFakeTimers();
    const onFail = vi.fn();
    const promise = createReadyPromise({
      pc: pc as unknown as RTCPeerConnection,
      channel: channel as unknown as RTCDataChannel,
      timeoutMs: 10,
      onFail,
    });
    vi.advanceTimersByTime(15);
    await expect(promise).rejects.toThrow('ready_timeout');
    expect(onFail).toHaveBeenCalledTimes(1);
  });

  it('rejects on abort signal', async () => {
    const controller = new AbortController();
    const onFail = vi.fn();
    const promise = createReadyPromise({
      pc: pc as unknown as RTCPeerConnection,
      channel: channel as unknown as RTCDataChannel,
      signal: controller.signal,
      onFail,
    });
    controller.abort();
    await expect(promise).rejects.toThrow();
    expect(onFail).toHaveBeenCalledTimes(1);
  });

  it('removes listeners after settle', async () => {
    const promise = createReadyPromise({
      pc: pc as unknown as RTCPeerConnection,
      channel: channel as unknown as RTCDataChannel,
    });
    channel.triggerOpen();
    await promise;
    expect(pc.listenerCount('iceconnectionstatechange')).toBe(0);
    expect(pc.listenerCount('connectionstatechange')).toBe(0);
    expect(channel.listenerCount('open')).toBe(0);
  });

  it('does not call onFail after resolve', async () => {
    const onFail = vi.fn();
    const promise = createReadyPromise({
      pc: pc as unknown as RTCPeerConnection,
      channel: channel as unknown as RTCDataChannel,
      onFail,
    });
    channel.triggerOpen();
    await promise;
    pc.triggerConnectionState('failed');
    expect(onFail).not.toHaveBeenCalled();
  });
});

describe('datachannel binary handling', () => {
  it('sets binaryType immediately for owner channel', async () => {
    const pc = new MockRTCPeerConnection();
    const channel = new MockDataChannel();
    pc.createDataChannel.mockReturnValue(channel);
    const createChannelPromise = getCreateChannelPromise();
    const result = await createChannelPromise(pc as unknown as RTCPeerConnection, 'owner', 'meta');
    expect(result).toBe(channel);
    expect(channel.binaryType).toBe('arraybuffer');
  });

  it('sets binaryType when guest receives datachannel', async () => {
    const pc = new MockRTCPeerConnection();
    const channel = new MockDataChannel('meta');
    const createChannelPromise = getCreateChannelPromise();
    const promise = createChannelPromise(pc as unknown as RTCPeerConnection, 'guest', 'meta');
    pc.emitDataChannel(channel as unknown as RTCDataChannel);
    const result = await promise;
    expect(result).toBe(channel);
    expect(channel.binaryType).toBe('arraybuffer');
  });

  it('onBinary resolves Blob payloads', async () => {
    const options = {
      dbRoomRef: {} as DatabaseReference,
      role: 'owner' as Role,
      encKey: new Uint8Array(0),
      timeoutMs: 1000,
    };
    const connection = new (
      WebRTCConnection as unknown as new (
        opts: typeof options,
      ) => WebRTCConnection
    )(options);
    (connection as unknown as { initialized: boolean }).initialized = true;
    const channel = new MockDataChannel();
    (connection as unknown as { _channel: RTCDataChannel })._channel =
      channel as unknown as RTCDataChannel;

    const handler = vi.fn();
    const dispose = connection.onBinary(handler);
    const data = new Blob([new Uint8Array([1, 2, 3])]);
    channel.fire('message', { data } as MessageEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(handler).toHaveBeenCalledTimes(1);
    const buffer = handler.mock.calls[0][0] as ArrayBuffer;
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array([1, 2, 3]));
    dispose();
  });
});

describe('send queueing', () => {
  const createConnection = (): {
    connection: WebRTCConnection;
    channel: MockDataChannel;
    pc: MockRTCPeerConnection;
  } => {
    const options = {
      dbRoomRef: {} as DatabaseReference,
      role: 'owner' as Role,
      encKey: new Uint8Array(0),
      timeoutMs: 1000,
    };
    const connection = new (
      WebRTCConnection as unknown as new (
        opts: typeof options,
      ) => WebRTCConnection
    )(options);
    const channel = new MockDataChannel();
    const pc = new MockRTCPeerConnection();
    (connection as unknown as { _channel: RTCDataChannel })._channel =
      channel as unknown as RTCDataChannel;
    (connection as unknown as { _pc: RTCPeerConnection })._pc = pc as unknown as RTCPeerConnection;
    (connection as unknown as { attachChannel: (ch: RTCDataChannel) => void }).attachChannel(
      channel as unknown as RTCDataChannel,
    );
    (connection as unknown as { initialized: boolean }).initialized = true;
    return { connection, channel, pc };
  };

  it('queues JSON messages until the channel opens', () => {
    const { connection, channel } = createConnection();
    const sendSpy = vi.spyOn(channel, 'send');
    connection.sendJSON({ hello: 'world' });
    expect(sendSpy).not.toHaveBeenCalled();
    channel.triggerOpen();
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(JSON.stringify({ hello: 'world' }));
  });

  it('queues binary messages until the channel opens', () => {
    const { connection, channel } = createConnection();
    const sendSpy = vi.spyOn(channel, 'send');
    const payload = new Uint8Array([1, 2, 3]);
    connection.sendBinary(payload);
    expect(sendSpy).not.toHaveBeenCalled();
    channel.triggerOpen();
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [firstCall] = sendSpy.mock.calls as unknown[][];
    const sentUnknown = firstCall?.[0];
    expect(sentUnknown).toBeInstanceOf(ArrayBuffer);
    if (!(sentUnknown instanceof ArrayBuffer)) {
      throw new Error('Expected ArrayBuffer payload to be sent');
    }
    expect(new Uint8Array(sentUnknown)).toEqual(payload);
  });

  it('throws when trying to send while channel is closed', () => {
    const { connection, channel } = createConnection();
    channel.setReadyState('closed');
    expect(() => connection.sendJSON({ fail: true })).toThrow('data_channel_unavailable');
  });
});
