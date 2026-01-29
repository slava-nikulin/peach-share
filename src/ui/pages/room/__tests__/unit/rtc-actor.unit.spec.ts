import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type RtcEndpoint, WebRTCConnection } from '../../../../lib/webrtc';
import { startRTC } from '../../fsm-actors/rtc';
import type { RtdbConnector } from '../../lib/RtdbConnector';
import type { RoomRecord } from '../../types';

type RefFactory = (db: unknown, path: string) => { path: string };

type RefMock = ReturnType<typeof vi.fn<RefFactory>>;

const { refMock }: { refMock: RefMock } = vi.hoisted((): { refMock: RefMock } => ({
  refMock: vi.fn<RefFactory>((_db, path) => ({ path })),
}));

vi.mock('firebase/database', () => ({
  ref: refMock,
}));

const noop = (): void => undefined;

const sampleRoom: RoomRecord = {
  room_id: 'room-123',
  owner: 'owner_uid',
  created_at: Date.now(),
  updated_at: Date.now(),
};

const createEndpoint = (ready: Promise<void>): RtcEndpoint => ({
  pc: {} as unknown as RTCPeerConnection,
  channel: {} as unknown as RTCDataChannel,
  sendJSON: vi.fn(),
  sendBinary: vi.fn(),
  onJSON: vi.fn().mockReturnValue(noop),
  onBinary: vi.fn().mockReturnValue(noop),
  close: vi.fn(),
  ready,
});

const createRtdbMock = (): {
  db: symbol;
  connect: ReturnType<typeof vi.fn>;
  ensureOnline: ReturnType<typeof vi.fn>;
  instance: RtdbConnector;
} => {
  const db = Symbol('db');
  const connect = vi.fn(() => db);
  const ensureOnline = vi.fn();
  const instance = {
    connect,
    ensureOnline,
  } as unknown as RtdbConnector;
  return { db, connect, ensureOnline, instance };
};

describe('startRTC actor', () => {
  beforeEach(() => {
    refMock.mockClear();
  });

  it('closes endpoint and rethrows when ready rejects', async () => {
    const readyError = new Error('ready_failed');
    const rtdb = createRtdbMock();
    const endpoint = createEndpoint(Promise.reject(readyError));
    const createSpy = vi
      .spyOn(WebRTCConnection, 'create')
      .mockResolvedValue(endpoint as unknown as WebRTCConnection);

    try {
      await expect(
        startRTC({
          room: sampleRoom,
          intent: 'create',
          encKey: new Uint8Array(32),
          timeoutMs: 5_000,
          stun: [],
          rtdb: rtdb.instance,
        }),
      ).rejects.toBe(readyError);

      expect(endpoint.close).toHaveBeenCalledTimes(1);
      expect(rtdb.connect).toHaveBeenCalledTimes(1);
      expect(rtdb.ensureOnline).toHaveBeenCalledTimes(1);
      expect(refMock).toHaveBeenCalledWith(rtdb.db, 'rooms/room-123');
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          abortSignal: undefined,
        }),
      );
    } finally {
      createSpy.mockRestore();
    }
  });

  it('passes abortSignal through and resolves on success', async () => {
    const endpoint = createEndpoint(Promise.resolve());
    const rtdb = createRtdbMock();
    const createSpy = vi
      .spyOn(WebRTCConnection, 'create')
      .mockResolvedValue(endpoint as unknown as WebRTCConnection);
    const controller = new AbortController();

    try {
      const result = await startRTC({
        room: sampleRoom,
        intent: 'join',
        encKey: new Uint8Array(32),
        timeoutMs: 5_000,
        stun: [{ urls: ['stun:example.org'] }],
        abortSignal: controller.signal,
        rtdb: rtdb.instance,
      });

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          abortSignal: controller.signal,
        }),
      );
      expect(rtdb.connect).toHaveBeenCalledTimes(1);
      expect(rtdb.ensureOnline).toHaveBeenCalledTimes(1);
      expect(refMock).toHaveBeenCalledWith(rtdb.db, 'rooms/room-123');
      expect(result.endpoint).toBe(endpoint);
      expect(endpoint.close).not.toHaveBeenCalled();
    } finally {
      createSpy.mockRestore();
    }
  });
});
