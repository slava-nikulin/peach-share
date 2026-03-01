import { uint8ArrayToBase64 } from 'uint8array-extras';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OtpClientPort } from '../../ports/otp-client';
import type { RoomIdKdfPort } from '../../ports/room-id-kdf';
import { type InitRoomRepositoryPort, InitRoomUseCase } from '../../use-cases/init-room';

const prs = 'test-prs';

const idFromBytes = (bytes: Uint8Array): string => uint8ArrayToBase64(bytes, { urlSafe: true });

describe('InitRoomUseCase (unit)', () => {
  let roomsRepo: InitRoomRepositoryPort;
  let kdf: RoomIdKdfPort;
  let otpClient: OtpClientPort;

  let roomExists: ReturnType<typeof vi.fn<InitRoomRepositoryPort['roomExists']>>;
  let deriveRoomId: ReturnType<typeof vi.fn<RoomIdKdfPort['deriveRoomId']>>;
  let currentRound: ReturnType<typeof vi.fn<OtpClientPort['currentRound']>>;
  let getOtp: ReturnType<typeof vi.fn<OtpClientPort['getOtp']>>;

  beforeEach(() => {
    roomExists = vi.fn<InitRoomRepositoryPort['roomExists']>();
    deriveRoomId = vi.fn<RoomIdKdfPort['deriveRoomId']>();
    currentRound = vi.fn<OtpClientPort['currentRound']>();
    getOtp = vi.fn<OtpClientPort['getOtp']>();

    roomsRepo = { roomExists };
    kdf = { deriveRoomId };
    otpClient = { currentRound, getOtp };
  });

  it('join: если current-roomId существует — возвращает join и не проверяет предыдущие roomId', async () => {
    currentRound.mockReturnValue(3);

    const otp3 = new Uint8Array([3]);
    const otp2 = new Uint8Array([2]);
    const otp1 = new Uint8Array([1]);

    getOtp.mockImplementation(async (round?: number) => {
      if (round === 3) return [otp3, 3];
      if (round === 2) return [otp2, 2];
      if (round === 1) return [otp1, 1];
      throw new Error(`unexpected round: ${round}`);
    });

    const out3 = new Uint8Array([251, 255, 255]); // base64: "+///", base64url: "-___"
    const out2 = new Uint8Array([255, 255, 255]); // base64url: "____"
    const out1 = new Uint8Array([0, 0, 0]); // base64url: "AAAA"

    deriveRoomId.mockImplementation(async (_prs, salt) => {
      if (salt === otp3) return out3;
      if (salt === otp2) return out2;
      if (salt === otp1) return out1;
      throw new Error('unexpected salt');
    });

    const id0 = idFromBytes(out3);
    roomExists.mockResolvedValue(true);

    const uc = new InitRoomUseCase(roomsRepo, kdf, otpClient);
    const res = await uc.run(prs);

    expect(res).toEqual({ intent: 'join', roomId: id0 });

    // OTP запрашиваются параллельно для всех round
    expect(currentRound).toHaveBeenCalledTimes(1);
    expect(getOtp).toHaveBeenCalledTimes(3);
    expect(getOtp).toHaveBeenNthCalledWith(1, 3);
    expect(getOtp).toHaveBeenNthCalledWith(2, 2);
    expect(getOtp).toHaveBeenNthCalledWith(3, 1);

    // derive/exists только для current (ранний выход)
    expect(deriveRoomId).toHaveBeenCalledTimes(1);
    expect(deriveRoomId).toHaveBeenCalledWith(prs, otp3);

    expect(roomExists).toHaveBeenCalledTimes(1);
    expect(roomExists).toHaveBeenCalledWith(id0);
  });

  it('join: current не существует, previous существует — возвращает join(previous) и останавливается', async () => {
    currentRound.mockReturnValue(3);

    const otp3 = new Uint8Array([3]);
    const otp2 = new Uint8Array([2]);
    const otp1 = new Uint8Array([1]);

    getOtp.mockImplementation(async (round?: number) => {
      if (round === 3) return [otp3, 3];
      if (round === 2) return [otp2, 2];
      if (round === 1) return [otp1, 1];
      throw new Error(`unexpected round: ${round}`);
    });

    const out3 = new Uint8Array([251, 255, 255]); // id0
    const out2 = new Uint8Array([255, 255, 255]); // id1
    const out1 = new Uint8Array([0, 0, 0]); // id2 (не должен понадобиться)

    deriveRoomId.mockImplementation(async (_prs, salt) => {
      if (salt === otp3) return out3;
      if (salt === otp2) return out2;
      if (salt === otp1) return out1;
      throw new Error('unexpected salt');
    });

    const id0 = idFromBytes(out3);
    const id1 = idFromBytes(out2);

    roomExists.mockImplementation(async (id) => id === id1);

    const uc = new InitRoomUseCase(roomsRepo, kdf, otpClient);
    const res = await uc.run(prs);

    expect(res).toEqual({ intent: 'join', roomId: id1 });

    expect(deriveRoomId).toHaveBeenCalledTimes(2);
    expect(roomExists).toHaveBeenCalledTimes(2);

    // порядок проверок: current → previous → stop
    expect(roomExists.mock.calls.map((c) => c[0])).toEqual([id0, id1]);
  });

  it('join: current и previous не существуют, but current-2 существует — возвращает join(current-2)', async () => {
    currentRound.mockReturnValue(3);

    const otp3 = new Uint8Array([3]);
    const otp2 = new Uint8Array([2]);
    const otp1 = new Uint8Array([1]);

    getOtp.mockImplementation(async (round?: number) => {
      if (round === 3) return [otp3, 3];
      if (round === 2) return [otp2, 2];
      if (round === 1) return [otp1, 1];
      throw new Error(`unexpected round: ${round}`);
    });

    const out3 = new Uint8Array([251, 255, 255]); // id0
    const out2 = new Uint8Array([255, 255, 255]); // id1
    const out1 = new Uint8Array([1, 2, 3]); // id2

    deriveRoomId.mockImplementation(async (_prs, salt) => {
      if (salt === otp3) return out3;
      if (salt === otp2) return out2;
      if (salt === otp1) return out1;
      throw new Error('unexpected salt');
    });

    const id0 = idFromBytes(out3);
    const id1 = idFromBytes(out2);
    const id2 = idFromBytes(out1);

    roomExists.mockImplementation(async (id) => id === id2);

    const uc = new InitRoomUseCase(roomsRepo, kdf, otpClient);
    const res = await uc.run(prs);

    expect(res).toEqual({ intent: 'join', roomId: id2 });

    expect(deriveRoomId).toHaveBeenCalledTimes(3);
    expect(roomExists).toHaveBeenCalledTimes(3);
    expect(roomExists.mock.calls.map((c) => c[0])).toEqual([id0, id1, id2]);
  });

  it('create: если ни один roomId не существует — возвращает create с roomId=current', async () => {
    currentRound.mockReturnValue(3);

    const otp3 = new Uint8Array([3]);
    const otp2 = new Uint8Array([2]);
    const otp1 = new Uint8Array([1]);

    getOtp.mockImplementation(async (round?: number) => {
      if (round === 3) return [otp3, 3];
      if (round === 2) return [otp2, 2];
      if (round === 1) return [otp1, 1];
      throw new Error(`unexpected round: ${round}`);
    });

    const out3 = new Uint8Array([251, 255, 255]); // id0
    const out2 = new Uint8Array([255, 255, 255]); // id1
    const out1 = new Uint8Array([1, 2, 3]); // id2

    deriveRoomId.mockImplementation(async (_prs, salt) => {
      if (salt === otp3) return out3;
      if (salt === otp2) return out2;
      if (salt === otp1) return out1;
      throw new Error('unexpected salt');
    });

    roomExists.mockResolvedValue(false);

    const id0 = idFromBytes(out3);
    const id1 = idFromBytes(out2);
    const id2 = idFromBytes(out1);

    const uc = new InitRoomUseCase(roomsRepo, kdf, otpClient);
    const res = await uc.run(prs);

    expect(res).toEqual({ intent: 'create', roomId: id0 });

    expect(deriveRoomId).toHaveBeenCalledTimes(3);
    expect(roomExists).toHaveBeenCalledTimes(3);
    expect(roomExists.mock.calls.map((c) => c[0])).toEqual([id0, id1, id2]);
  });

  it('currentRound=1: rounds=[1] — если room не существует, вернёт create', async () => {
    currentRound.mockReturnValue(1);

    const otp1 = new Uint8Array([1]);
    getOtp.mockResolvedValue([otp1, 1]);

    const out1 = new Uint8Array([251, 255, 255]);
    deriveRoomId.mockResolvedValue(out1);

    const id0 = idFromBytes(out1);
    roomExists.mockResolvedValue(false);

    const uc = new InitRoomUseCase(roomsRepo, kdf, otpClient);
    const res = await uc.run(prs);

    expect(res).toEqual({ intent: 'create', roomId: id0 });

    expect(getOtp).toHaveBeenCalledTimes(1);
    expect(getOtp).toHaveBeenCalledWith(1);
    expect(deriveRoomId).toHaveBeenCalledTimes(1);
    expect(roomExists).toHaveBeenCalledTimes(1);
  });

  it('currentRound=2: rounds=[2,1] (0 отфильтровывается) — проверка корректных аргументов getOtp', async () => {
    currentRound.mockReturnValue(2);

    const otp2 = new Uint8Array([2]);
    const otp1 = new Uint8Array([1]);

    getOtp.mockImplementation(async (round?: number) => {
      if (round === 2) return [otp2, 2];
      if (round === 1) return [otp1, 1];
      throw new Error(`unexpected round: ${round}`);
    });

    const out2 = new Uint8Array([251, 255, 255]); // id0 (current=2)
    const out1 = new Uint8Array([255, 255, 255]); // id1
    deriveRoomId.mockImplementation(async (_prs, salt) => {
      if (salt === otp2) return out2;
      if (salt === otp1) return out1;
      throw new Error('unexpected salt');
    });

    const id1 = idFromBytes(out1);

    roomExists.mockImplementation(async (id) => id === id1);

    const uc = new InitRoomUseCase(roomsRepo, kdf, otpClient);
    const res = await uc.run(prs);

    expect(res).toEqual({ intent: 'join', roomId: id1 });

    expect(getOtp).toHaveBeenCalledTimes(2);
    expect(getOtp).toHaveBeenNthCalledWith(1, 2);
    expect(getOtp).toHaveBeenNthCalledWith(2, 1);
  });

  it('ошибка: getOtp reject в любом из раундов → use-case reject, derive/exists не вызываются', async () => {
    currentRound.mockReturnValue(3);

    const otp3 = new Uint8Array([3]);
    const otp1 = new Uint8Array([1]);
    const err = new Error('otp failed');

    getOtp.mockImplementation(async (round?: number) => {
      if (round === 3) return [otp3, 3];
      if (round === 2) throw err;
      if (round === 1) return [otp1, 1];
      throw new Error(`unexpected round: ${round}`);
    });

    const uc = new InitRoomUseCase(roomsRepo, kdf, otpClient);

    await expect(uc.run(prs)).rejects.toBe(err);

    expect(getOtp).toHaveBeenCalledTimes(3);
    expect(deriveRoomId).not.toHaveBeenCalled();
    expect(roomExists).not.toHaveBeenCalled();
  });

  it('ошибка: deriveRoomId reject на current → use-case reject, roomExists не вызывается', async () => {
    currentRound.mockReturnValue(1);

    const otp1 = new Uint8Array([1]);
    getOtp.mockResolvedValue([otp1, 1]);

    const err = new Error('kdf failed');
    deriveRoomId.mockRejectedValue(err);

    const uc = new InitRoomUseCase(roomsRepo, kdf, otpClient);

    await expect(uc.run(prs)).rejects.toBe(err);

    expect(roomExists).not.toHaveBeenCalled();
  });

  it('ошибка: roomExists reject на current → use-case reject, прошлые раунды не проверяются', async () => {
    currentRound.mockReturnValue(3);

    const otp3 = new Uint8Array([3]);
    const otp2 = new Uint8Array([2]);
    const otp1 = new Uint8Array([1]);

    getOtp.mockImplementation(async (round?: number) => {
      if (round === 3) return [otp3, 3];
      if (round === 2) return [otp2, 2];
      if (round === 1) return [otp1, 1];
      throw new Error(`unexpected round: ${round}`);
    });

    const out3 = new Uint8Array([251, 255, 255]);
    const out2 = new Uint8Array([255, 255, 255]);
    const out1 = new Uint8Array([1, 2, 3]);

    deriveRoomId.mockImplementation(async (_prs, salt) => {
      if (salt === otp3) return out3;
      if (salt === otp2) return out2;
      if (salt === otp1) return out1;
      throw new Error('unexpected salt');
    });

    const err = new Error('repo failed');
    roomExists.mockRejectedValue(err);

    const uc = new InitRoomUseCase(roomsRepo, kdf, otpClient);

    await expect(uc.run(prs)).rejects.toBe(err);

    // только current успел
    expect(deriveRoomId).toHaveBeenCalledTimes(1);
    expect(roomExists).toHaveBeenCalledTimes(1);
  });

  it('ошибка: deriveRoomId reject на previous (после того как current not exists) → use-case reject', async () => {
    currentRound.mockReturnValue(2);

    const otp2 = new Uint8Array([2]);
    const otp1 = new Uint8Array([1]);

    getOtp.mockImplementation(async (round?: number) => {
      if (round === 2) return [otp2, 2];
      if (round === 1) return [otp1, 1];
      throw new Error(`unexpected round: ${round}`);
    });

    const out2 = new Uint8Array([251, 255, 255]);
    const err = new Error('kdf failed on previous');

    deriveRoomId.mockImplementation(async (_prs, salt) => {
      if (salt === otp2) return out2; // current ok
      if (salt === otp1) throw err; // previous падает
      throw new Error('unexpected salt');
    });

    roomExists.mockResolvedValue(false); // current not exists

    const uc = new InitRoomUseCase(roomsRepo, kdf, otpClient);

    await expect(uc.run(prs)).rejects.toBe(err);

    // roomExists был вызван только для current
    expect(roomExists).toHaveBeenCalledTimes(1);
  });

  it('edge-case: currentRound=0 → rounds=[], текущая реализация падает TypeError', async () => {
    currentRound.mockReturnValue(0);

    const uc = new InitRoomUseCase(roomsRepo, kdf, otpClient);

    await expect(uc.run(prs)).rejects.toBeInstanceOf(TypeError);

    expect(getOtp).not.toHaveBeenCalled();
    expect(deriveRoomId).not.toHaveBeenCalled();
    expect(roomExists).not.toHaveBeenCalled();
  });
});
