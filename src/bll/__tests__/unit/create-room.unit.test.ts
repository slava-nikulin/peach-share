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
import { CreateRoomUseCase } from '../../use-cases/create-room';

const te: TextEncoder = new TextEncoder();

interface HappyPathFixture {
  sid: string;
  rtcSid: string;
  prsBytes: Uint8Array;
  msgAbytes: Uint8Array;
  msgA: string;
  msgBbytes: Uint8Array;
  msg_b: string;
  isk: Uint8Array;
  kcAB64u: string;
  offer: string;
  answer: string;
  channel: P2pChannel;
}

describe('CreateRoomUseCase (unit)', () => {
  const uid = 'u-1';
  const roomId = 'AQID'; // base64 for [1,2,3]; safe for base64/base64url
  const timeoutMs = 10_000;
  const waitSecondSideMs = 7_000;
  const rtcTimeoutMs = 3_000;

  // --- ports (mocks) ---
  let roomsRepo: RoomRepositoryPort;
  let pake: PakePort;
  let webRtc: WebRtcPort;

  // RoomRepositoryPort mocks
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

  // PakePort mocks
  let newSession: ReturnType<typeof vi.fn<PakePort['newSession']>>;
  let start: ReturnType<typeof vi.fn<PakePort['start']>>;
  let receive: ReturnType<typeof vi.fn<PakePort['receive']>>;
  let exportISK: ReturnType<typeof vi.fn<PakePort['exportISK']>>;
  let pakeDestroy: ReturnType<typeof vi.fn<PakePort['destroy']>>;

  // WebRtcPort mocks
  let newRtcSession: ReturnType<typeof vi.fn<WebRtcPort['newSession']>>;
  let generateOffer: ReturnType<typeof vi.fn<WebRtcPort['generateOffer']>>;
  let acceptAnswer: ReturnType<typeof vi.fn<WebRtcPort['acceptAnswer']>>;
  let generateAnswer: ReturnType<typeof vi.fn<WebRtcPort['generateAnswer']>>;
  let waitConnected: ReturnType<typeof vi.fn<WebRtcPort['waitConnected']>>;
  let rtcDestroy: ReturnType<typeof vi.fn<WebRtcPort['destroy']>>;

  beforeEach(() => {
    // repo
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

    // pake
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

    // webrtc
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

  const makeUc = (): CreateRoomUseCase =>
    new CreateRoomUseCase(roomsRepo, pake, webRtc, timeoutMs, waitSecondSideMs, rtcTimeoutMs);

  const setupHappyPath = async (): Promise<HappyPathFixture> => {
    const sid = 'pake-sid-1';
    const rtcSid = 'rtc-sid-1';

    const prsBytes = base64ToUint8Array(roomId);
    newSession.mockReturnValue(sid);

    const msgAbytes = new Uint8Array([10, 11, 12]);
    start.mockResolvedValue(msgAbytes);

    const msgA = uint8ArrayToBase64(msgAbytes, { urlSafe: true });

    const msgBbytes = new Uint8Array([21, 22, 23, 24]);
    const msg_b = uint8ArrayToBase64(msgBbytes, { urlSafe: true });
    waitB.mockResolvedValue(msg_b);
    receive.mockResolvedValue(new Uint8Array()); // initiator игнорирует payload

    const isk = new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]);
    exportISK.mockReturnValue(isk);

    // derive macKey and tags exactly like in use-case
    const sidBytes = te.encode(`rooms:pake:v1:${roomId}`);
    const macKey = deriveMacKeyBytes(sidBytes, isk);

    const kcABytes = hmacSha256(macKey, msgAbytes);
    const kcAB64u = uint8ArrayToBase64(kcABytes, { urlSafe: true });

    const kcBBytes = hmacSha256(macKey, msgBbytes);
    const kcBB64u = uint8ArrayToBase64(kcBBytes, { urlSafe: true });
    waitKcB.mockResolvedValue(kcBB64u);

    roomCreate.mockResolvedValue(undefined);
    writeA.mockResolvedValue(undefined);
    writeKcA.mockResolvedValue(undefined);

    newRtcSession.mockReturnValue(rtcSid);

    const offer = '{"type":"offer","sdp":"..."}';
    generateOffer.mockResolvedValue(offer);
    writeOffer.mockResolvedValue(undefined);

    const answer = '{"type":"answer","sdp":"..."}';
    const answerEnc = encryptWebRtcSignal(isk, roomId, 'answer', answer);
    waitAnswer.mockResolvedValue(answerEnc);

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
      msg_b,
      isk,
      kcAB64u,
      offer,
      answer,
      channel,
    };
  };

  it('happy-path: создает room, проходит CPace, устанавливает WebRTC, возвращает channel; finalize+pake.destroy вызываются', async () => {
    const h = await setupHappyPath();
    const uc = makeUc();

    const res = await uc.run(uid, roomId);

    expect(res).toBe(h.channel);

    // pake session created before try
    expect(newSession).toHaveBeenCalledTimes(1);
    expect(newSession).toHaveBeenCalledWith('initiator', h.prsBytes);

    // repo create / A / B
    expect(roomCreate).toHaveBeenCalledWith(uid, roomId, waitSecondSideMs);
    expect(start).toHaveBeenCalledWith(h.sid);
    expect(writeA).toHaveBeenCalledWith(roomId, h.msgA);
    expect(waitB).toHaveBeenCalledWith(roomId, waitSecondSideMs);

    expect(receive).toHaveBeenCalledWith(h.sid, h.msgBbytes);
    expect(exportISK).toHaveBeenCalledWith(h.sid);

    // key confirmation (kcA written, kcB waited with timeoutMs)
    expect(writeKcA).toHaveBeenCalledWith(roomId, h.kcAB64u);
    expect(waitKcB).toHaveBeenCalledWith(roomId, timeoutMs);

    // WebRTC part
    expect(newRtcSession).toHaveBeenCalledWith('initiator');
    expect(generateOffer).toHaveBeenCalledWith(h.rtcSid);

    // writeOffer: не проверяем строку напрямую (может быть недетерминированной),
    // но проверяем что она корректно дешифруется в исходный offer.
    expect(writeOffer).toHaveBeenCalledTimes(1);
    const [writeOfferCall] = writeOffer.mock.calls;
    if (!writeOfferCall) throw new Error('writeOffer was not called');
    const offerEncArg = writeOfferCall[1];
    expect(decryptWebRtcSignal(h.isk, roomId, 'offer', offerEncArg)).toBe(h.offer);

    expect(waitAnswer).toHaveBeenCalledWith(roomId, rtcTimeoutMs);
    expect(acceptAnswer).toHaveBeenCalledWith(h.rtcSid, h.answer);

    expect(waitConnected).toHaveBeenCalledWith(h.rtcSid, rtcTimeoutMs);

    // cleanup
    expect(rtcDestroy).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledWith(roomId);
    expect(pakeDestroy).toHaveBeenCalledWith(h.sid);
  });

  it('kcB invalid: бросает ошибку, webrtc НЕ стартует; catch вызывает webRtc.destroy(""); finally вызывает finalize + pake.destroy', async () => {
    const h = await setupHappyPath();

    // делаем kcB неправильным
    const bad = uint8ArrayToBase64(new Uint8Array([1, 2, 3, 4]), { urlSafe: true });
    waitKcB.mockResolvedValueOnce(bad);

    const uc = makeUc();
    await expect(uc.run(uid, roomId)).rejects.toThrow('CPace key confirmation failed: invalid kcB');

    // webrtc не создавался
    expect(newRtcSession).not.toHaveBeenCalled();
    expect(generateOffer).not.toHaveBeenCalled();
    expect(waitAnswer).not.toHaveBeenCalled();
    expect(waitConnected).not.toHaveBeenCalled();

    // catch пытается destroy('') и глотает ошибки destroy (если бы были)
    expect(rtcDestroy).toHaveBeenCalledTimes(1);
    expect(rtcDestroy).toHaveBeenCalledWith('');

    // finally
    expect(finalize).toHaveBeenCalledWith(roomId);
    expect(pakeDestroy).toHaveBeenCalledWith(h.sid);
  });

  it('ошибка в roomsRepo.roomCreate: пробрасывает; start/writeA/... не вызываются; destroy("") + finalize + pake.destroy', async () => {
    const h = await setupHappyPath();
    const err = new Error('roomCreate failed');
    roomCreate.mockRejectedValueOnce(err);

    const uc = makeUc();
    await expect(uc.run(uid, roomId)).rejects.toBe(err);

    expect(start).not.toHaveBeenCalled();
    expect(writeA).not.toHaveBeenCalled();
    expect(waitB).not.toHaveBeenCalled();

    expect(rtcDestroy).toHaveBeenCalledWith('');
    expect(finalize).toHaveBeenCalledWith(roomId);
    expect(pakeDestroy).toHaveBeenCalledWith(h.sid);
  });

  it('ошибка в roomsRepo.waitB: destroy("") + finalize + pake.destroy; дальше не идёт', async () => {
    const h = await setupHappyPath();
    const err = new Error('waitB failed');
    waitB.mockRejectedValueOnce(err);

    const uc = makeUc();
    await expect(uc.run(uid, roomId)).rejects.toBe(err);

    expect(receive).not.toHaveBeenCalled();
    expect(writeKcA).not.toHaveBeenCalled();
    expect(waitKcB).not.toHaveBeenCalled();

    expect(rtcDestroy).toHaveBeenCalledWith('');
    expect(finalize).toHaveBeenCalledWith(roomId);
    expect(pakeDestroy).toHaveBeenCalledWith(h.sid);
  });

  it('ошибка в webRtc.generateOffer (после newSession): catch уничтожает rtcSid; finally finalize + pake.destroy', async () => {
    const h = await setupHappyPath();
    const err = new Error('generateOffer failed');
    generateOffer.mockRejectedValueOnce(err);

    const uc = makeUc();
    await expect(uc.run(uid, roomId)).rejects.toBe(err);

    expect(newRtcSession).toHaveBeenCalled();
    expect(rtcDestroy).toHaveBeenCalledWith(h.rtcSid);

    expect(finalize).toHaveBeenCalledWith(roomId);
    expect(pakeDestroy).toHaveBeenCalledWith(h.sid);
  });

  it('acceptAnswer бросает синхронную ошибку: catch уничтожает rtcSid; waitConnected не вызывается', async () => {
    const h = await setupHappyPath();
    const err = new Error('acceptAnswer failed');
    acceptAnswer.mockImplementationOnce(() => {
      throw err;
    });

    const uc = makeUc();
    await expect(uc.run(uid, roomId)).rejects.toBe(err);

    expect(waitConnected).not.toHaveBeenCalled();
    expect(rtcDestroy).toHaveBeenCalledWith(h.rtcSid);

    expect(finalize).toHaveBeenCalledWith(roomId);
    expect(pakeDestroy).toHaveBeenCalledWith(h.sid);
  });

  it('waitConnected reject: catch уничтожает rtcSid; finally finalize + pake.destroy', async () => {
    const h = await setupHappyPath();
    const err = new Error('waitConnected timeout');
    waitConnected.mockRejectedValueOnce(err);

    const uc = makeUc();
    await expect(uc.run(uid, roomId)).rejects.toBe(err);

    expect(rtcDestroy).toHaveBeenCalledWith(h.rtcSid);
    expect(finalize).toHaveBeenCalledWith(roomId);
    expect(pakeDestroy).toHaveBeenCalledWith(h.sid);
  });

  it('finalize reject в happy-path: ошибка подавляется, run всё равно resolve channel', async () => {
    const h = await setupHappyPath();
    finalize.mockRejectedValueOnce(new Error('finalize failed'));

    const uc = makeUc();
    await expect(uc.run(uid, roomId)).resolves.toBe(h.channel);

    expect(pakeDestroy).toHaveBeenCalledWith(h.sid);
  });

  it('webRtc.destroy бросает в catch: ошибка destroy подавляется, пробрасывается исходная ошибка', async () => {
    const h = await setupHappyPath();

    const rootErr = new Error('generateOffer failed');
    generateOffer.mockRejectedValueOnce(rootErr);

    rtcDestroy.mockImplementationOnce(() => {
      throw new Error('destroy failed');
    });

    const uc = makeUc();
    await expect(uc.run(uid, roomId)).rejects.toBe(rootErr);

    expect(finalize).toHaveBeenCalledWith(roomId);
    expect(pakeDestroy).toHaveBeenCalledWith(h.sid);
  });

  it('ошибка в pake.newSession (вне try): finalize и webRtc.destroy НЕ вызываются; pake.destroy тоже НЕ вызывается', async () => {
    const err = new Error('newSession failed');
    newSession.mockImplementationOnce(() => {
      throw err;
    });

    const uc = makeUc();
    await expect(uc.run(uid, roomId)).rejects.toBe(err);

    expect(roomCreate).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
    expect(rtcDestroy).not.toHaveBeenCalled();
    expect(pakeDestroy).not.toHaveBeenCalled();
  });

  it('pake.destroy бросает в finally: эта ошибка пробрасывается (перекрывает успешный результат)', async () => {
    await setupHappyPath();

    const err = new Error('pake.destroy failed');
    pakeDestroy.mockImplementationOnce(() => {
      throw err;
    });

    const uc = makeUc();
    await expect(uc.run(uid, roomId)).rejects.toBe(err);

    // при этом finalize пытались вызвать (и ошибки finalize глотаются)
    expect(finalize).toHaveBeenCalledWith(roomId);
  });
});
