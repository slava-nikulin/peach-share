/** biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: <explanation> */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as crypto from '../../../lib/crypto';
import type { P2pChannel } from '../../ports/p2p-channel';
import type { PakePort, PakeSessionId } from '../../ports/pake';
import type { RoomRepositoryPort } from '../../ports/room-repository';
import type { WebRtcPort, WebRtcSessionId } from '../../ports/webrtc';
import { CreateRoomUseCase } from '../../use-cases/create-room';

describe('CreateRoomUseCase (unit)', () => {
  const roomId = 'AQID'; // валидный base64 => [1,2,3]

  const mkU8 = (...xs: number[]) => new Uint8Array(xs);

  const mkChannel = (): P2pChannel => ({
    send: vi.fn(),
    onReceive: vi.fn(() => () => {}),
  });

  type Deps = {
    roomsRepo: RoomRepositoryPort;
    pake: PakePort;
    webRtc: WebRtcPort;
  };

  const mkDeps = (): Deps => {
    const roomsRepo: RoomRepositoryPort = {
      roomExists: vi.fn(async () => true),
      deleteRoom: vi.fn(async () => {}),

      writeA: vi.fn(async () => {}),
      writeB: vi.fn(async () => {}),
      waitA: vi.fn(async () => 'AQID'),
      waitB: vi.fn(async () => 'BAUG'), // валидный base64
      writeKcA: vi.fn(async () => {}),
      writeKcB: vi.fn(async () => {}),
      waitKcA: vi.fn(async () => 'BwcI'), // валидный base64
      waitKcB: vi.fn(async () => 'CQoL'), // валидный base64

      writeOffer: vi.fn(async () => {}),
      waitOffer: vi.fn(async () => 'w1:AAAA'), // не используется в initiator usecase
      writeAnswer: vi.fn(async () => {}),
      waitAnswer: vi.fn(async () => 'w1:BBBB'),
    };

    const pake: PakePort = {
      newSession: vi.fn((): PakeSessionId => 'pake_sid_1'),
      start: vi.fn(async () => mkU8(1, 2, 3)), // msgAbytes
      receive: vi.fn(async () => mkU8()), // initiator receive -> empty
      exportISK: vi.fn(() => mkU8(9, 9, 9, 9)),
      destroy: vi.fn(() => {}),
    };

    const webRtc: WebRtcPort = {
      newSession: vi.fn((): WebRtcSessionId => 'rtc_sid_1'),
      generateOffer: vi.fn(async () => '{"type":"offer"}'),
      acceptAnswer: vi.fn(() => {}),
      generateAnswer: vi.fn(async () => '{"type":"answer"}'),
      waitConnected: vi.fn(async () => mkChannel()),
      destroy: vi.fn(() => {}),
    };

    return { roomsRepo, pake, webRtc };
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('happy path: writes A, waits B(30000), confirms KC, encrypts offer, decrypts answer, waits connected; no deleteRoom/webRtc.destroy', async () => {
    const { roomsRepo, pake, webRtc } = mkDeps();

    // crypto: контролируем verify/encrypt/decrypt, чтобы тест был про usecase, а не про криптографию
    const spyVerify = vi.spyOn(crypto, 'hmacSha256Verify').mockReturnValue(true);
    const spyEncrypt = vi
      .spyOn(crypto, 'encryptWebRtcSignal')
      .mockReturnValue('w1:ENCRYPTED_OFFER');
    const spyDecrypt = vi.spyOn(crypto, 'decryptWebRtcSignal').mockReturnValue('{"type":"answer"}');

    const uc = new CreateRoomUseCase(roomsRepo, pake, webRtc, 10_000);
    await uc.run(roomId);

    expect(pake.newSession).toHaveBeenCalledTimes(1);
    expect(pake.start).toHaveBeenCalledTimes(1);
    expect(roomsRepo.writeA).toHaveBeenCalledTimes(1);

    // важный нюанс: waitB должен быть 30000
    expect(roomsRepo.waitB).toHaveBeenCalledWith(roomId, 30000);

    expect(pake.receive).toHaveBeenCalledTimes(1);
    expect(pake.exportISK).toHaveBeenCalledTimes(1);

    expect(roomsRepo.writeKcA).toHaveBeenCalledTimes(1);
    expect(roomsRepo.waitKcB).toHaveBeenCalledTimes(1);
    expect(spyVerify).toHaveBeenCalledTimes(1);

    expect(webRtc.newSession).toHaveBeenCalledWith('initiator');
    expect(webRtc.generateOffer).toHaveBeenCalledWith('rtc_sid_1');

    // offer должен быть зашифрован перед записью
    expect(spyEncrypt).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      roomId,
      'offer',
      '{"type":"offer"}',
    );
    expect(roomsRepo.writeOffer).toHaveBeenCalledWith(roomId, 'w1:ENCRYPTED_OFFER');

    // answer должен быть расшифрован перед acceptAnswer
    expect(roomsRepo.waitAnswer).toHaveBeenCalledTimes(1);
    expect(spyDecrypt).toHaveBeenCalledWith(expect.any(Uint8Array), roomId, 'answer', 'w1:BBBB');
    expect(webRtc.acceptAnswer).toHaveBeenCalledWith('rtc_sid_1', '{"type":"answer"}');

    expect(webRtc.waitConnected).toHaveBeenCalledWith('rtc_sid_1', 10_000);

    // cleanup: pake.destroy всегда
    expect(pake.destroy).toHaveBeenCalledWith('pake_sid_1');

    // на success не должно быть чистки комнаты/rtc
    expect(roomsRepo.deleteRoom).not.toHaveBeenCalled();
    expect(webRtc.destroy).not.toHaveBeenCalled();
  });

  it('fails if waitB rejects: propagates error, calls deleteRoom and pake.destroy; rtc not created', async () => {
    const { roomsRepo, pake, webRtc } = mkDeps();
    (roomsRepo.waitB as any).mockRejectedValueOnce(new Error('waitB failed'));

    const uc = new CreateRoomUseCase(roomsRepo, pake, webRtc, 10_000);
    await expect(uc.run(roomId)).rejects.toThrow('waitB failed');

    expect(roomsRepo.writeA).toHaveBeenCalledTimes(1);
    expect(webRtc.newSession).not.toHaveBeenCalled();

    // cleanup
    expect(webRtc.destroy).toHaveBeenCalledTimes(1); // called with '' in current implementation
    expect(roomsRepo.deleteRoom).toHaveBeenCalledWith(roomId);
    expect(pake.destroy).toHaveBeenCalledWith('pake_sid_1');
  });

  it('fails if KC verify returns false: propagates error, calls deleteRoom and pake.destroy; rtc not created', async () => {
    const { roomsRepo, pake, webRtc } = mkDeps();
    vi.spyOn(crypto, 'hmacSha256Verify').mockReturnValue(false);

    const uc = new CreateRoomUseCase(roomsRepo, pake, webRtc, 10_000);
    await expect(uc.run(roomId)).rejects.toThrow('CPace key confirmation failed: invalid kcB');

    expect(webRtc.newSession).not.toHaveBeenCalled();

    // cleanup
    expect(roomsRepo.deleteRoom).toHaveBeenCalledWith(roomId);
    expect(pake.destroy).toHaveBeenCalledWith('pake_sid_1');
  });

  it('fails if webRtc.generateOffer rejects: destroys rtc session and deletes room', async () => {
    const { roomsRepo, pake, webRtc } = mkDeps();
    vi.spyOn(crypto, 'hmacSha256Verify').mockReturnValue(true);
    (webRtc.generateOffer as any).mockRejectedValueOnce(new Error('ice servers unreachable'));

    const uc = new CreateRoomUseCase(roomsRepo, pake, webRtc, 10_000);
    await expect(uc.run(roomId)).rejects.toThrow('ice servers unreachable');

    expect(webRtc.newSession).toHaveBeenCalled();
    expect(webRtc.destroy).toHaveBeenCalledWith('rtc_sid_1');
    expect(roomsRepo.deleteRoom).toHaveBeenCalledWith(roomId);
    expect(pake.destroy).toHaveBeenCalledWith('pake_sid_1');
  });

  it('fails if waitAnswer rejects: destroys rtc session and deletes room', async () => {
    const { roomsRepo, pake, webRtc } = mkDeps();
    vi.spyOn(crypto, 'hmacSha256Verify').mockReturnValue(true);
    vi.spyOn(crypto, 'encryptWebRtcSignal').mockReturnValue('w1:ENCRYPTED_OFFER');
    (roomsRepo.waitAnswer as any).mockRejectedValueOnce(new Error('waitAnswer timeout'));

    const uc = new CreateRoomUseCase(roomsRepo, pake, webRtc, 10_000);
    await expect(uc.run(roomId)).rejects.toThrow('waitAnswer timeout');

    expect(webRtc.destroy).toHaveBeenCalledWith('rtc_sid_1');
    expect(roomsRepo.deleteRoom).toHaveBeenCalledWith(roomId);
    expect(pake.destroy).toHaveBeenCalledWith('pake_sid_1');
  });

  it('fails if decryptWebRtcSignal throws: destroys rtc session and deletes room', async () => {
    const { roomsRepo, pake, webRtc } = mkDeps();
    vi.spyOn(crypto, 'hmacSha256Verify').mockReturnValue(true);
    vi.spyOn(crypto, 'encryptWebRtcSignal').mockReturnValue('w1:ENCRYPTED_OFFER');
    vi.spyOn(crypto, 'decryptWebRtcSignal').mockImplementation(() => {
      throw new Error('decrypt failed');
    });

    const uc = new CreateRoomUseCase(roomsRepo, pake, webRtc, 10_000);
    await expect(uc.run(roomId)).rejects.toThrow('decrypt failed');

    expect(webRtc.destroy).toHaveBeenCalledWith('rtc_sid_1');
    expect(roomsRepo.deleteRoom).toHaveBeenCalledWith(roomId);
    expect(pake.destroy).toHaveBeenCalledWith('pake_sid_1');
  });

  it('fails if webRtc.acceptAnswer throws: destroys rtc session and deletes room', async () => {
    const { roomsRepo, pake, webRtc } = mkDeps();
    vi.spyOn(crypto, 'hmacSha256Verify').mockReturnValue(true);
    vi.spyOn(crypto, 'encryptWebRtcSignal').mockReturnValue('w1:ENCRYPTED_OFFER');
    vi.spyOn(crypto, 'decryptWebRtcSignal').mockReturnValue('{"type":"answer"}');
    (webRtc.acceptAnswer as any).mockImplementation(() => {
      throw new Error('acceptAnswer failed');
    });

    const uc = new CreateRoomUseCase(roomsRepo, pake, webRtc, 10_000);
    await expect(uc.run(roomId)).rejects.toThrow('acceptAnswer failed');

    expect(webRtc.destroy).toHaveBeenCalledWith('rtc_sid_1');
    expect(roomsRepo.deleteRoom).toHaveBeenCalledWith(roomId);
    expect(pake.destroy).toHaveBeenCalledWith('pake_sid_1');
  });

  it('fails if webRtc.waitConnected rejects (e.g., ICE/DTLS failure): destroys rtc session and deletes room', async () => {
    const { roomsRepo, pake, webRtc } = mkDeps();
    vi.spyOn(crypto, 'hmacSha256Verify').mockReturnValue(true);
    vi.spyOn(crypto, 'encryptWebRtcSignal').mockReturnValue('w1:ENCRYPTED_OFFER');
    vi.spyOn(crypto, 'decryptWebRtcSignal').mockReturnValue('{"type":"answer"}');
    (webRtc.waitConnected as any).mockRejectedValueOnce(new Error('connect failed: ice timeout'));

    const uc = new CreateRoomUseCase(roomsRepo, pake, webRtc, 10_000);
    await expect(uc.run(roomId)).rejects.toThrow('connect failed: ice timeout');

    expect(webRtc.destroy).toHaveBeenCalledWith('rtc_sid_1');
    expect(roomsRepo.deleteRoom).toHaveBeenCalledWith(roomId);
    expect(pake.destroy).toHaveBeenCalledWith('pake_sid_1');
  });

  it('swallows errors from webRtc.destroy and roomsRepo.deleteRoom; original error still propagates', async () => {
    const { roomsRepo, pake, webRtc } = mkDeps();
    (roomsRepo.waitB as any).mockRejectedValueOnce(new Error('waitB failed'));
    (webRtc.destroy as any).mockImplementation(() => {
      throw new Error('destroy failed');
    });
    (roomsRepo.deleteRoom as any).mockRejectedValueOnce(new Error('deleteRoom failed'));

    const uc = new CreateRoomUseCase(roomsRepo, pake, webRtc, 10_000);
    await expect(uc.run(roomId)).rejects.toThrow('waitB failed');

    expect(pake.destroy).toHaveBeenCalledWith('pake_sid_1');
    expect(webRtc.destroy).toHaveBeenCalledTimes(1);
    expect(roomsRepo.deleteRoom).toHaveBeenCalledTimes(1);
  });

  it('fails if waitKcB rejects: propagates error, deletes room, destroys pake; rtc not created', async () => {
    const { roomsRepo, pake, webRtc } = mkDeps();
    (roomsRepo.waitKcB as any).mockRejectedValueOnce(new Error('waitKcB timeout'));

    const uc = new CreateRoomUseCase(roomsRepo, pake, webRtc, 10_000);
    await expect(uc.run(roomId)).rejects.toThrow('waitKcB timeout');

    expect(webRtc.newSession).not.toHaveBeenCalled();
    expect(roomsRepo.deleteRoom).toHaveBeenCalledWith(roomId);
    expect(pake.destroy).toHaveBeenCalledWith('pake_sid_1');
  });
});
