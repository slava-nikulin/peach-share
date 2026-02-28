import { base64ToUint8Array, uint8ArrayToBase64 } from 'uint8array-extras';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decryptWebRtcSignal,
  deriveMacKeyBytes,
  encryptWebRtcSignal,
  hmacSha256,
} from '../../../lib/crypto';
import type { P2pChannel } from '../../ports/p2p-channel';
import type { PakePort } from '../../ports/pake';
import type { RoomRepositoryPort } from '../../ports/room-repository';
import type { WebRtcPort } from '../../ports/webrtc';
import { JoinRoomUseCase } from '../../use-cases/join-room';

const te: TextEncoder = new TextEncoder();

interface HappyPathFixture {
  sid: string;
  rtcSid: string;
  prsBytes: Uint8Array;
  msgAbytes: Uint8Array;
  msgA: string;
  msgBbytes: Uint8Array;
  msgB: string;
  isk: Uint8Array;
  kcBB64u: string;
  offer: string;
  offerEnc: string;
  answer: string;
  channel: P2pChannel;
}

describe('JoinRoomUseCase (unit)', () => {
  const uid = 'u-1';
  const roomId = 'AQID'; // base64 for [1,2,3]
  const timeoutMs = 10_000;
  const rtcTimeoutMs = 3_000;

  // ports
  let roomsRepo: RoomRepositoryPort;
  let pake: PakePort;
  let webRtc: WebRtcPort;

  // repo mocks
  let roomCreate: ReturnType<typeof vi.fn<RoomRepositoryPort['roomCreate']>>;
  let roomJoin: ReturnType<typeof vi.fn<RoomRepositoryPort['roomJoin']>>;
  let finalize: ReturnType<typeof vi.fn<RoomRepositoryPort['finalize']>>;
  let waitA: ReturnType<typeof vi.fn<RoomRepositoryPort['waitA']>>;
  let writeA: ReturnType<typeof vi.fn<RoomRepositoryPort['writeA']>>;
  let waitB: ReturnType<typeof vi.fn<RoomRepositoryPort['waitB']>>;
  let writeB: ReturnType<typeof vi.fn<RoomRepositoryPort['writeB']>>;
  let waitKcA: ReturnType<typeof vi.fn<RoomRepositoryPort['waitKcA']>>;
  let writeKcA: ReturnType<typeof vi.fn<RoomRepositoryPort['writeKcA']>>;
  let waitKcB: ReturnType<typeof vi.fn<RoomRepositoryPort['waitKcB']>>;
  let writeKcB: ReturnType<typeof vi.fn<RoomRepositoryPort['writeKcB']>>;
  let waitOffer: ReturnType<typeof vi.fn<RoomRepositoryPort['waitOffer']>>;
  let writeOffer: ReturnType<typeof vi.fn<RoomRepositoryPort['writeOffer']>>;
  let waitAnswer: ReturnType<typeof vi.fn<RoomRepositoryPort['waitAnswer']>>;
  let writeAnswer: ReturnType<typeof vi.fn<RoomRepositoryPort['writeAnswer']>>;

  // pake mocks
  let newSession: ReturnType<typeof vi.fn<PakePort['newSession']>>;
  let start: ReturnType<typeof vi.fn<PakePort['start']>>;
  let receive: ReturnType<typeof vi.fn<PakePort['receive']>>;
  let exportISK: ReturnType<typeof vi.fn<PakePort['exportISK']>>;
  let pakeDestroy: ReturnType<typeof vi.fn<PakePort['destroy']>>;

  // webrtc mocks
  let newRtcSession: ReturnType<typeof vi.fn<WebRtcPort['newSession']>>;
  let generateOffer: ReturnType<typeof vi.fn<WebRtcPort['generateOffer']>>;
  let acceptAnswer: ReturnType<typeof vi.fn<WebRtcPort['acceptAnswer']>>;
  let generateAnswer: ReturnType<typeof vi.fn<WebRtcPort['generateAnswer']>>;
  let waitConnected: ReturnType<typeof vi.fn<WebRtcPort['waitConnected']>>;
  let rtcDestroy: ReturnType<typeof vi.fn<WebRtcPort['destroy']>>;

  beforeEach(() => {
    roomCreate = vi.fn<RoomRepositoryPort['roomCreate']>();
    roomJoin = vi.fn<RoomRepositoryPort['roomJoin']>();
    finalize = vi.fn<RoomRepositoryPort['finalize']>();
    waitA = vi.fn<RoomRepositoryPort['waitA']>();
    writeA = vi.fn<RoomRepositoryPort['writeA']>();
    waitB = vi.fn<RoomRepositoryPort['waitB']>();
    writeB = vi.fn<RoomRepositoryPort['writeB']>();
    waitKcA = vi.fn<RoomRepositoryPort['waitKcA']>();
    writeKcA = vi.fn<RoomRepositoryPort['writeKcA']>();
    waitKcB = vi.fn<RoomRepositoryPort['waitKcB']>();
    writeKcB = vi.fn<RoomRepositoryPort['writeKcB']>();
    waitOffer = vi.fn<RoomRepositoryPort['waitOffer']>();
    writeOffer = vi.fn<RoomRepositoryPort['writeOffer']>();
    waitAnswer = vi.fn<RoomRepositoryPort['waitAnswer']>();
    writeAnswer = vi.fn<RoomRepositoryPort['writeAnswer']>();

    roomsRepo = {
      roomCreate,
      roomJoin,
      finalize,
      waitA,
      writeA,
      waitB,
      writeB,
      waitKcA,
      writeKcA,
      waitKcB,
      writeKcB,
      waitOffer,
      writeOffer,
      waitAnswer,
      writeAnswer,
    };

    newSession = vi.fn<PakePort['newSession']>();
    start = vi.fn<PakePort['start']>();
    receive = vi.fn<PakePort['receive']>();
    exportISK = vi.fn<PakePort['exportISK']>();
    pakeDestroy = vi.fn<PakePort['destroy']>();

    pake = {
      newSession,
      start,
      receive,
      exportISK,
      destroy: pakeDestroy,
    };

    newRtcSession = vi.fn<WebRtcPort['newSession']>();
    generateOffer = vi.fn<WebRtcPort['generateOffer']>();
    acceptAnswer = vi.fn<WebRtcPort['acceptAnswer']>();
    generateAnswer = vi.fn<WebRtcPort['generateAnswer']>();
    waitConnected = vi.fn<WebRtcPort['waitConnected']>();
    rtcDestroy = vi.fn<WebRtcPort['destroy']>();

    webRtc = {
      newSession: newRtcSession,
      generateOffer,
      acceptAnswer,
      generateAnswer,
      waitConnected,
      destroy: rtcDestroy,
    };
  });

  const makeUc = (): JoinRoomUseCase =>
    new JoinRoomUseCase(roomsRepo, pake, webRtc, timeoutMs, rtcTimeoutMs);

  const setupHappyPath = (): HappyPathFixture => {
    const sid = 'pake-sid-1';
    const rtcSid = 'rtc-sid-1';

    const prsBytes = base64ToUint8Array(roomId);
    newSession.mockReturnValue(sid);

    roomJoin.mockResolvedValue(undefined);

    const msgAbytes = new Uint8Array([10, 11, 12, 13]);
    const msgA = uint8ArrayToBase64(msgAbytes, { urlSafe: true });
    waitA.mockResolvedValue(msgA);

    const msgBbytes = new Uint8Array([21, 22, 23]);
    receive.mockResolvedValue(msgBbytes);

    const msgB = uint8ArrayToBase64(msgBbytes, { urlSafe: true });
    writeB.mockResolvedValue(undefined);

    const isk = new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]);
    exportISK.mockReturnValue(isk);

    const sidBytes = te.encode(`rooms:pake:v1:${roomId}`);
    const macKey = deriveMacKeyBytes(sidBytes, isk);

    // kcB computed from msgBbytes; written by responder
    const kcBbytes = hmacSha256(macKey, msgBbytes);
    const kcBB64u = uint8ArrayToBase64(kcBbytes, { urlSafe: true });

    // kcA must verify against msgAbytes
    const kcAbytes = hmacSha256(macKey, msgAbytes);
    const kcAB64u = uint8ArrayToBase64(kcAbytes, { urlSafe: true });

    writeKcB.mockResolvedValue(undefined);
    waitKcA.mockResolvedValue(kcAB64u);

    newRtcSession.mockReturnValue(rtcSid);

    const offer = '{"type":"offer","sdp":"..."}';
    const offerEnc = encryptWebRtcSignal(isk, roomId, 'offer', offer);
    waitOffer.mockResolvedValue(offerEnc);

    const answer = '{"type":"answer","sdp":"..."}';
    generateAnswer.mockResolvedValue(answer);

    writeAnswer.mockResolvedValue(undefined);

    const channel: P2pChannel = {
      readable: new ReadableStream<Uint8Array>(),
      writable: new WritableStream<Uint8Array>(),
      close: (): void => {},
      onClose: (cb: () => void): (() => void) => {
        void cb;
        return (): void => {};
      },
    };
    waitConnected.mockResolvedValue(channel);

    finalize.mockResolvedValue(undefined);

    return {
      sid,
      rtcSid,
      prsBytes,
      msgAbytes,
      msgA,
      msgBbytes,
      msgB,
      isk,
      kcBB64u,
      offer,
      offerEnc,
      answer,
      channel,
    };
  };

  it('happy-path: join→CPace→WebRTC; возвращает channel; finally вызывает finalize + pake.destroy', async () => {
    const h = setupHappyPath();
    const uc = makeUc();

    const res = await uc.run(uid, roomId);
    expect(res).toBe(h.channel);

    // newSession (вне try)
    expect(newSession).toHaveBeenCalledWith('responder', h.prsBytes);

    // join + receive A
    expect(roomJoin).toHaveBeenCalledWith(uid, roomId, timeoutMs);
    expect(waitA).toHaveBeenCalledWith(roomId, timeoutMs);
    expect(receive).toHaveBeenCalledWith(h.sid, base64ToUint8Array(h.msgA));

    // write B
    expect(writeB).toHaveBeenCalledWith(roomId, h.msgB);

    // write kcB, wait kcA
    expect(writeKcB).toHaveBeenCalledWith(roomId, h.kcBB64u);
    expect(waitKcA).toHaveBeenCalledWith(roomId, timeoutMs);

    // WebRTC
    expect(newRtcSession).toHaveBeenCalledWith('responder');
    expect(waitOffer).toHaveBeenCalledWith(roomId, rtcTimeoutMs);

    // offer decrypt check
    // (waitOffer returns promise) — проверяем аргумент generateAnswer: это результат decrypt(offerEnc)
    expect(generateAnswer).toHaveBeenCalledTimes(1);
    const [generateAnswerCall] = generateAnswer.mock.calls;
    if (!generateAnswerCall) throw new Error('generateAnswer was not called');
    const offerArg = generateAnswerCall[1];
    expect(offerArg).toBe(h.offer);

    expect(writeAnswer).toHaveBeenCalledTimes(1);
    const [writeAnswerCall] = writeAnswer.mock.calls;
    if (!writeAnswerCall) throw new Error('writeAnswer was not called');
    const answerEncArg = writeAnswerCall[1];
    expect(decryptWebRtcSignal(h.isk, roomId, 'answer', answerEncArg)).toBe(h.answer);

    expect(waitConnected).toHaveBeenCalledWith(h.rtcSid, rtcTimeoutMs);

    // cleanup
    expect(finalize).toHaveBeenCalledWith(roomId);
    expect(pakeDestroy).toHaveBeenCalledWith(h.sid);
  });

  it('kcA invalid: бросает ошибку; webRtc.newSession не вызывается; finally finalize + pake.destroy', async () => {
    const h = setupHappyPath();

    // портим kcA
    const badKcA = uint8ArrayToBase64(new Uint8Array([1, 2, 3, 4]), { urlSafe: true });
    waitKcA.mockResolvedValueOnce(badKcA);

    const uc = makeUc();
    await expect(uc.run(uid, roomId)).rejects.toThrow('CPace key confirmation failed: invalid kcA');

    expect(newRtcSession).not.toHaveBeenCalled();
    expect(waitOffer).not.toHaveBeenCalled();
    expect(generateAnswer).not.toHaveBeenCalled();
    expect(writeAnswer).not.toHaveBeenCalled();
    expect(waitConnected).not.toHaveBeenCalled();

    expect(finalize).toHaveBeenCalledWith(roomId);
    expect(pakeDestroy).toHaveBeenCalledWith(h.sid);
  });

  it('ошибка roomJoin: пробрасывается; waitA/... не вызываются; finally finalize + pake.destroy', async () => {
    const h = setupHappyPath();
    const err = new Error('roomJoin failed');
    roomJoin.mockRejectedValueOnce(err);

    const uc = makeUc();
    await expect(uc.run(uid, roomId)).rejects.toBe(err);

    expect(waitA).not.toHaveBeenCalled();
    expect(receive).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledWith(roomId);
    expect(pakeDestroy).toHaveBeenCalledWith(h.sid);
  });

  it('ошибка waitA: пробрасывается; finally finalize + pake.destroy', async () => {
    const h = setupHappyPath();
    const err = new Error('waitA failed');
    waitA.mockRejectedValueOnce(err);

    const uc = makeUc();
    await expect(uc.run(uid, roomId)).rejects.toBe(err);

    expect(receive).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledWith(roomId);
    expect(pakeDestroy).toHaveBeenCalledWith(h.sid);
  });

  it('ошибка pake.receive: пробрасывается; writeB/writeKcB не вызываются; finally finalize + pake.destroy', async () => {
    const h = setupHappyPath();
    const err = new Error('pake.receive failed');
    receive.mockRejectedValueOnce(err);

    const uc = makeUc();
    await expect(uc.run(uid, roomId)).rejects.toBe(err);

    expect(writeB).not.toHaveBeenCalled();
    expect(writeKcB).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledWith(roomId);
    expect(pakeDestroy).toHaveBeenCalledWith(h.sid);
  });

  it('ошибка writeB: пробрасывается; дальше не идёт; finally finalize + pake.destroy', async () => {
    const h = setupHappyPath();
    const err = new Error('writeB failed');
    writeB.mockRejectedValueOnce(err);

    const uc = makeUc();
    await expect(uc.run(uid, roomId)).rejects.toBe(err);

    expect(writeKcB).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledWith(roomId);
    expect(pakeDestroy).toHaveBeenCalledWith(h.sid);
  });

  it('ошибка writeKcB: пробрасывается; waitKcA и WebRTC не вызываются; finally finalize + pake.destroy', async () => {
    const h = setupHappyPath();
    const err = new Error('writeKcB failed');
    writeKcB.mockRejectedValueOnce(err);

    const uc = makeUc();
    await expect(uc.run(uid, roomId)).rejects.toBe(err);

    expect(waitKcA).not.toHaveBeenCalled();
    expect(newRtcSession).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledWith(roomId);
    expect(pakeDestroy).toHaveBeenCalledWith(h.sid);
  });

  it('ошибка waitKcA: пробрасывается; WebRTC не стартует; finally finalize + pake.destroy', async () => {
    const h = setupHappyPath();
    const err = new Error('waitKcA failed');
    waitKcA.mockRejectedValueOnce(err);

    const uc = makeUc();
    await expect(uc.run(uid, roomId)).rejects.toBe(err);

    expect(newRtcSession).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledWith(roomId);
    expect(pakeDestroy).toHaveBeenCalledWith(h.sid);
  });

  it('ошибка waitOffer (после webRtcSid создан): пробрасывается; finally finalize + pake.destroy (webRtc.destroy НЕ вызывается по дизайну)', async () => {
    const h = setupHappyPath();
    const err = new Error('waitOffer failed');
    waitOffer.mockRejectedValueOnce(err);

    const uc = makeUc();
    await expect(uc.run(uid, roomId)).rejects.toBe(err);

    expect(newRtcSession).toHaveBeenCalled(); // rtcSid успел создаться
    expect(rtcDestroy).not.toHaveBeenCalled(); // в JoinRoomUseCase нет catch, только finally

    expect(finalize).toHaveBeenCalledWith(roomId);
    expect(pakeDestroy).toHaveBeenCalledWith(h.sid);
  });

  it('ошибка generateAnswer: пробрасывается; writeAnswer не вызывается; finally finalize + pake.destroy', async () => {
    const h = setupHappyPath();
    const err = new Error('generateAnswer failed');
    generateAnswer.mockRejectedValueOnce(err);

    const uc = makeUc();
    await expect(uc.run(uid, roomId)).rejects.toBe(err);

    expect(writeAnswer).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledWith(roomId);
    expect(pakeDestroy).toHaveBeenCalledWith(h.sid);
  });

  it('ошибка writeAnswer: пробрасывается; waitConnected не вызывается; finally finalize + pake.destroy', async () => {
    const h = setupHappyPath();
    const err = new Error('writeAnswer failed');
    writeAnswer.mockRejectedValueOnce(err);

    const uc = makeUc();
    await expect(uc.run(uid, roomId)).rejects.toBe(err);

    expect(waitConnected).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledWith(roomId);
    expect(pakeDestroy).toHaveBeenCalledWith(h.sid);
  });

  it('waitConnected reject: пробрасывается; finally finalize + pake.destroy', async () => {
    const h = setupHappyPath();
    const err = new Error('waitConnected timeout');
    waitConnected.mockRejectedValueOnce(err);

    const uc = makeUc();
    await expect(uc.run(uid, roomId)).rejects.toBe(err);

    expect(finalize).toHaveBeenCalledWith(roomId);
    expect(pakeDestroy).toHaveBeenCalledWith(h.sid);
  });

  it('finalize reject: ошибка подавляется; run всё равно resolve channel', async () => {
    const h = setupHappyPath();
    finalize.mockRejectedValueOnce(new Error('finalize failed'));

    const uc = makeUc();
    await expect(uc.run(uid, roomId)).resolves.toBe(h.channel);

    expect(pakeDestroy).toHaveBeenCalledWith(h.sid);
  });

  it('pake.destroy бросает в finally: эта ошибка пробрасывается (перекрывает и успех, и исходную ошибку)', async () => {
    setupHappyPath();
    const err = new Error('pake.destroy failed');
    pakeDestroy.mockImplementationOnce(() => {
      throw err;
    });

    const uc = makeUc();
    await expect(uc.run(uid, roomId)).rejects.toBe(err);

    expect(finalize).toHaveBeenCalledWith(roomId);
  });

  it('ошибка в pake.newSession (вне try/finally): finalize и pake.destroy НЕ вызываются', async () => {
    const err = new Error('newSession failed');
    newSession.mockImplementationOnce(() => {
      throw err;
    });

    const uc = makeUc();
    await expect(uc.run(uid, roomId)).rejects.toBe(err);

    expect(roomJoin).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
    expect(pakeDestroy).not.toHaveBeenCalled();
  });
});
