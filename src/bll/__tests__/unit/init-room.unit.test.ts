/** biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: <explanation> */
import { uint8ArrayToBase64 } from 'uint8array-extras';
import { describe, expect, it, vi } from 'vitest';
import type { OtpClientPort } from '../../ports/otp-client';
import type { RoomIdKdfPort } from '../../ports/room-id-kdf';
import type { RoomRepositoryPort } from '../../ports/room-repository';
import { InitRoomUseCase } from '../../use-cases/init-room';

function derivedBytes(salt: Uint8Array): Uint8Array {
  // Детерминированно и уникально для разных salt
  return Uint8Array.of(salt[0], 1, 2);
}

function roomIdFromSalt(salt: Uint8Array): string {
  return uint8ArrayToBase64(derivedBytes(salt), { urlSafe: true });
}

function makeOtpMock(params: {
  latestRound: number;
  latestSalt: Uint8Array;
  saltByRound: Map<number, Uint8Array>;
}) {
  const getOtp = vi
    .fn<(round?: number) => Promise<[Uint8Array, number]>>()
    .mockImplementation(async (r?: number) => {
      if (r === undefined) return [params.latestSalt, params.latestRound];

      const salt = params.saltByRound.get(r);
      if (!salt) throw new Error(`Unexpected round requested: ${r}`);
      return [salt, r];
    });

  const otpClient: OtpClientPort = { getOtp: getOtp };
  return { otpClient, getOpt: getOtp };
}

function makeKdfMock() {
  const deriveRoomId = vi
    .fn<(prs: string, salt: Uint8Array) => Promise<Uint8Array>>()
    .mockImplementation(async (_prs: string, salt: Uint8Array) => derivedBytes(salt));

  const kdf: RoomIdKdfPort = { deriveRoomId };
  return { kdf, deriveRoomId };
}

function makeRepoMock(existsById: (roomId: string) => boolean) {
  const roomExists = vi
    .fn<(roomId: string) => Promise<boolean>>()
    .mockImplementation(async (id: string) => existsById(id));
  const roomsRepo: RoomRepositoryPort = { roomExists };
  return { roomsRepo, roomExists };
}

describe('InitRoomUseCase', () => {
  it('join: если комната существует в текущем окне (id0)', async () => {
    const prs = 'secret-prs';
    const latestRound = 5;

    const salt0 = Uint8Array.of(10); // latest
    const id0 = roomIdFromSalt(salt0);

    const { otpClient, getOpt: getOtp } = makeOtpMock({
      latestRound,
      latestSalt: salt0,
      saltByRound: new Map([
        [4, Uint8Array.of(40)],
        [3, Uint8Array.of(30)],
        [2, Uint8Array.of(20)],
      ]),
    });
    const { kdf, deriveRoomId } = makeKdfMock();
    const { roomsRepo, roomExists } = makeRepoMock((id) => id === id0);

    const uc = new InitRoomUseCase(roomsRepo, kdf, otpClient);
    const res = await uc.run(prs);

    expect(res).toEqual({ intent: 'join', roomId: id0 });

    // Важные взаимодействия
    expect(getOtp).toHaveBeenCalledTimes(1);
    expect(deriveRoomId).toHaveBeenCalledTimes(1);
    expect(deriveRoomId).toHaveBeenCalledWith(prs, salt0);
    expect(roomExists).toHaveBeenCalledTimes(1);
    expect(roomExists).toHaveBeenCalledWith(id0);
  });

  it('join: если id0 отсутствует, но найден кандидат в прошлом окне (delta=2)', async () => {
    const prs = 'secret-prs';
    const latestRound = 5;

    const salt0 = Uint8Array.of(10); // latest
    const saltR4 = Uint8Array.of(40); // round 4 (delta=1)
    const saltR3 = Uint8Array.of(30); // round 3 (delta=2) <-- найдём тут
    const saltR2 = Uint8Array.of(20); // round 2 (delta=3)

    const id0 = roomIdFromSalt(salt0);
    const idR4 = roomIdFromSalt(saltR4);
    const idR3 = roomIdFromSalt(saltR3);

    const { otpClient, getOpt } = makeOtpMock({
      latestRound,
      latestSalt: salt0,
      saltByRound: new Map([
        [4, saltR4],
        [3, saltR3],
        [2, saltR2],
      ]),
    });
    const { kdf } = makeKdfMock();
    const { roomsRepo, roomExists } = makeRepoMock((id) => id === idR3);

    const uc = new InitRoomUseCase(roomsRepo, kdf, otpClient);
    const res = await uc.run(prs);

    expect(res).toEqual({ intent: 'join', roomId: idR3 });

    // Порядок вызовов getOpt детерминирован: сначала latest, потом 4,3,2
    expect(getOpt).toHaveBeenCalledTimes(4);
    expect(getOpt).toHaveBeenNthCalledWith(1); // undefined
    expect(getOpt).toHaveBeenNthCalledWith(2, 4);
    expect(getOpt).toHaveBeenNthCalledWith(3, 3);
    expect(getOpt).toHaveBeenNthCalledWith(4, 2);

    // Проверяем, что все кандидаты действительно проверялись
    expect(roomExists).toHaveBeenCalledTimes(3);
    expect(roomExists).toHaveBeenCalledWith(id0);
    expect(roomExists).toHaveBeenCalledWith(idR4);
    expect(roomExists).toHaveBeenCalledWith(idR3);
  });

  it('create: если ни id0, ни кандидаты (до 3 прошлых окон) не существуют', async () => {
    const prs = 'secret-prs';
    const latestRound = 5;

    const salt0 = Uint8Array.of(10);
    const saltR4 = Uint8Array.of(40);
    const saltR3 = Uint8Array.of(30);
    const saltR2 = Uint8Array.of(20);

    const id0 = roomIdFromSalt(salt0);

    const { otpClient } = makeOtpMock({
      latestRound,
      latestSalt: salt0,
      saltByRound: new Map([
        [4, saltR4],
        [3, saltR3],
        [2, saltR2],
      ]),
    });
    const { kdf } = makeKdfMock();
    const { roomsRepo, roomExists } = makeRepoMock(() => false);

    const uc = new InitRoomUseCase(roomsRepo, kdf, otpClient);
    const res = await uc.run(prs);

    expect(res).toEqual({ intent: 'create', roomId: id0 });
    expect(roomExists).toHaveBeenCalledTimes(4); // id0 + 3 кандидата
  });

  it('round=2: проверяется только одно прошлое окно (round-1)', async () => {
    const prs = 'secret-prs';
    const latestRound = 2;

    const salt0 = Uint8Array.of(10); // latest
    const saltR1 = Uint8Array.of(11); // round 1 (delta=1)
    const idR1 = roomIdFromSalt(saltR1);
    const id0 = roomIdFromSalt(salt0);

    const { otpClient, getOpt } = makeOtpMock({
      latestRound,
      latestSalt: salt0,
      saltByRound: new Map([[1, saltR1]]),
    });
    const { kdf } = makeKdfMock();
    const { roomsRepo, roomExists } = makeRepoMock((id) => id === idR1);

    const uc = new InitRoomUseCase(roomsRepo, kdf, otpClient);
    const res = await uc.run(prs);

    expect(res).toEqual({ intent: 'join', roomId: idR1 });

    expect(getOpt).toHaveBeenCalledTimes(2);
    expect(getOpt).toHaveBeenNthCalledWith(1); // latest
    expect(getOpt).toHaveBeenNthCalledWith(2, 1);

    // roomExists: сначала id0, потом один кандидат
    expect(roomExists).toHaveBeenCalledTimes(2);
    expect(roomExists).toHaveBeenCalledWith(id0);
    expect(roomExists).toHaveBeenCalledWith(idR1);
  });

  it('round=1: прошлые окна не проверяются (deltas пустой), результат create', async () => {
    const prs = 'secret-prs';
    const latestRound = 1;

    const salt0 = Uint8Array.of(10);
    const id0 = roomIdFromSalt(salt0);

    const { otpClient, getOpt } = makeOtpMock({
      latestRound,
      latestSalt: salt0,
      saltByRound: new Map(), // не должно быть запросов
    });
    const { kdf, deriveRoomId } = makeKdfMock();
    const { roomsRepo, roomExists } = makeRepoMock(() => false);

    const uc = new InitRoomUseCase(roomsRepo, kdf, otpClient);
    const res = await uc.run(prs);

    expect(res).toEqual({ intent: 'create', roomId: id0 });

    expect(getOpt).toHaveBeenCalledTimes(1);
    expect(deriveRoomId).toHaveBeenCalledTimes(1);
    expect(roomExists).toHaveBeenCalledTimes(1);
  });

  it('join: если есть несколько кандидатов, выбирается ближайший (delta=1 приоритетнее delta=3)', async () => {
    const prs = 'secret-prs';
    const latestRound = 5;

    const salt0 = Uint8Array.of(10);
    const saltR4 = Uint8Array.of(40); // delta=1 (должен победить)
    const saltR3 = Uint8Array.of(30);
    const saltR2 = Uint8Array.of(20); // delta=3 (тоже существует, но не должен выбираться)

    const id0 = roomIdFromSalt(salt0);
    const idR4 = roomIdFromSalt(saltR4);
    const idR2 = roomIdFromSalt(saltR2);

    const { otpClient } = makeOtpMock({
      latestRound,
      latestSalt: salt0,
      saltByRound: new Map([
        [4, saltR4],
        [3, saltR3],
        [2, saltR2],
      ]),
    });
    const { kdf } = makeKdfMock();
    const { roomsRepo } = makeRepoMock((id) => id === idR4 || id === idR2);

    const uc = new InitRoomUseCase(roomsRepo, kdf, otpClient);
    const res = await uc.run(prs);

    expect(res).toEqual({ intent: 'join', roomId: idR4 });

    // sanity: id0 не существует, иначе вернули бы join(id0)
    expect(id0).not.toEqual(idR4);
  });

  it('ошибка внешней зависимости пробрасывается: если roomExists бросает error, run() должен reject', async () => {
    const prs = 'secret-prs';
    const latestRound = 5;

    const salt0 = Uint8Array.of(10);

    const { otpClient, getOpt } = makeOtpMock({
      latestRound,
      latestSalt: salt0,
      saltByRound: new Map([
        [4, Uint8Array.of(40)],
        [3, Uint8Array.of(30)],
        [2, Uint8Array.of(20)],
      ]),
    });
    const { kdf, deriveRoomId } = makeKdfMock();

    const roomExists = vi
      .fn<(roomId: string) => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('db down'));
    const roomsRepo: RoomRepositoryPort = { roomExists };

    const uc = new InitRoomUseCase(roomsRepo, kdf, otpClient);

    await expect(uc.run(prs)).rejects.toThrow('db down');

    // До проверки кандидатов дело не дошло
    expect(getOpt).toHaveBeenCalledTimes(1);
    expect(deriveRoomId).toHaveBeenCalledTimes(1);
    expect(roomExists).toHaveBeenCalledTimes(1);
  });
});
