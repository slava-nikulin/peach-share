/** biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: <explanation> */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as crypto from '../../../lib/crypto';
import type { P2pChannel } from '../../ports/p2p-channel';
import type { PakePort, PakeSessionId } from '../../ports/pake';
import type { RoomRepositoryPort } from '../../ports/room-repository';
import type { WebRtcPort, WebRtcSessionId } from '../../ports/webrtc';
import { JoinRoomUseCase } from '../../use-cases/join-room';

describe('JoinRoomUseCase (unit)', () => {
  const roomId = 'AQID'; // base64 => [1,2,3]

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
      waitA: vi.fn(async () => 'AQID'), // msgA
      waitB: vi.fn(async () => 'BAUG'),

      writeKcA: vi.fn(async () => {}),
      writeKcB: vi.fn(async () => {}),
      waitKcA: vi.fn(async () => 'BwcI'), // kcA
      waitKcB: vi.fn(async () => 'CQoL'),

      writeOffer: vi.fn(async () => {}),
      waitOffer: vi.fn(async () => 'w1:OFFER_ENC'),

      writeAnswer: vi.fn(async () => {}),
      waitAnswer: vi.fn(async () => 'w1:ANSWER_ENC'),
    };

    const pake: PakePort = {
      newSession: vi.fn((): PakeSessionId => 'pake_sid_r1'),
      start: vi.fn(async () => mkU8(1, 2, 3)),
      receive: vi.fn(async () => mkU8(4, 5, 6)), // responder: msgBbytes
      exportISK: vi.fn(() => mkU8(9, 9, 9, 9)),
      destroy: vi.fn(() => {}),
    };

    const webRtc: WebRtcPort = {
      newSession: vi.fn((): WebRtcSessionId => 'rtc_sid_r1'),
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

  it('happy path: waits A, receives->writes B, writes kcB, verifies kcA, decrypts offer, generates answer, encrypts answer, writes answer, waits connected; always destroys pake; does NOT delete room or destroy rtc', async () => {
    const { roomsRepo, pake, webRtc } = mkDeps();

    const spyVerify = vi.spyOn(crypto, 'hmacSha256Verify').mockReturnValue(true);
    const spyDecrypt = vi.spyOn(crypto, 'decryptWebRtcSignal').mockReturnValue('{"type":"offer"}');
    const spyEncrypt = vi.spyOn(crypto, 'encryptWebRtcSignal').mockReturnValue('w1:ANSWER_ENC');

    const uc = new JoinRoomUseCase(roomsRepo, pake, webRtc, 10_000);
    await uc.run(roomId);

    expect(pake.newSession).toHaveBeenCalledWith('responder', expect.any(Uint8Array));
    expect(roomsRepo.waitA).toHaveBeenCalledWith(roomId, 10_000);

    expect(pake.receive).toHaveBeenCalledTimes(1);
    expect(roomsRepo.writeB).toHaveBeenCalledTimes(1);

    expect(pake.exportISK).toHaveBeenCalledTimes(1);

    expect(roomsRepo.writeKcB).toHaveBeenCalledTimes(1);
    expect(roomsRepo.waitKcA).toHaveBeenCalledWith(roomId, 10_000);
    expect(spyVerify).toHaveBeenCalledTimes(1);

    expect(webRtc.newSession).toHaveBeenCalledWith('responder');

    expect(roomsRepo.waitOffer).toHaveBeenCalledWith(roomId, 10_000);
    expect(spyDecrypt).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      roomId,
      'offer',
      'w1:OFFER_ENC',
    );

    expect(webRtc.generateAnswer).toHaveBeenCalledWith('rtc_sid_r1', '{"type":"offer"}');

    expect(spyEncrypt).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      roomId,
      'answer',
      '{"type":"answer"}',
    );
    expect(roomsRepo.writeAnswer).toHaveBeenCalledWith(roomId, 'w1:ANSWER_ENC');

    expect(webRtc.waitConnected).toHaveBeenCalledWith('rtc_sid_r1', 10_000);

    // cleanup
    expect(pake.destroy).toHaveBeenCalledWith('pake_sid_r1');

    // по текущей реализации JoinRoomUseCase не чистит room и не destroy rtc
    expect(roomsRepo.deleteRoom).not.toHaveBeenCalled();
    expect(webRtc.destroy).not.toHaveBeenCalled();
  });

  it('fails if KC verify returns false: propagates error; still destroys pake; does NOT create rtc session', async () => {
    const { roomsRepo, pake, webRtc } = mkDeps();
    vi.spyOn(crypto, 'hmacSha256Verify').mockReturnValue(false);

    const uc = new JoinRoomUseCase(roomsRepo, pake, webRtc, 10_000);
    await expect(uc.run(roomId)).rejects.toThrow('CPace key confirmation failed: invalid kcA');

    expect(webRtc.newSession).not.toHaveBeenCalled();
    expect(pake.destroy).toHaveBeenCalledWith('pake_sid_r1');
  });

  it('fails if waitA rejects: propagates error; still destroys pake', async () => {
    const { roomsRepo, pake, webRtc } = mkDeps();
    (roomsRepo.waitA as any).mockRejectedValueOnce(new Error('waitA failed'));

    const uc = new JoinRoomUseCase(roomsRepo, pake, webRtc, 10_000);
    await expect(uc.run(roomId)).rejects.toThrow('waitA failed');

    expect(webRtc.newSession).not.toHaveBeenCalled();
    expect(pake.destroy).toHaveBeenCalledWith('pake_sid_r1');
  });

  it('fails if pake.receive rejects: propagates error; still destroys pake; does NOT write B', async () => {
    const { roomsRepo, pake } = mkDeps();
    (pake.receive as any).mockRejectedValueOnce(new Error('pake.receive failed'));

    const uc = new JoinRoomUseCase(roomsRepo, pake, mkDeps().webRtc, 10_000);
    await expect(uc.run(roomId)).rejects.toThrow('pake.receive failed');

    expect(roomsRepo.writeB).not.toHaveBeenCalled();
    expect(pake.destroy).toHaveBeenCalledWith('pake_sid_r1');
  });

  it('fails if writeB rejects: propagates error; still destroys pake', async () => {
    const { roomsRepo, pake, webRtc } = mkDeps();
    (roomsRepo.writeB as any).mockRejectedValueOnce(new Error('writeB failed'));

    const uc = new JoinRoomUseCase(roomsRepo, pake, webRtc, 10_000);
    await expect(uc.run(roomId)).rejects.toThrow('writeB failed');

    expect(pake.destroy).toHaveBeenCalledWith('pake_sid_r1');
  });

  it('fails if waitKcA rejects: propagates error; still destroys pake; does NOT create rtc session', async () => {
    const { roomsRepo, pake, webRtc } = mkDeps();
    (roomsRepo.waitKcA as any).mockRejectedValueOnce(new Error('waitKcA timeout'));

    const uc = new JoinRoomUseCase(roomsRepo, pake, webRtc, 10_000);
    await expect(uc.run(roomId)).rejects.toThrow('waitKcA timeout');

    expect(webRtc.newSession).not.toHaveBeenCalled();
    expect(pake.destroy).toHaveBeenCalledWith('pake_sid_r1');
  });

  it('fails if waitOffer rejects: propagates error; still destroys pake; rtc session is created but NOT destroyed (current design)', async () => {
    const { roomsRepo, pake, webRtc } = mkDeps();
    vi.spyOn(crypto, 'hmacSha256Verify').mockReturnValue(true);
    (roomsRepo.waitOffer as any).mockRejectedValueOnce(new Error('waitOffer timeout'));

    const uc = new JoinRoomUseCase(roomsRepo, pake, webRtc, 10_000);
    await expect(uc.run(roomId)).rejects.toThrow('waitOffer timeout');

    expect(webRtc.newSession).toHaveBeenCalledWith('responder');
    expect(webRtc.destroy).not.toHaveBeenCalled(); // фиксируем текущее поведение
    expect(pake.destroy).toHaveBeenCalledWith('pake_sid_r1');
  });

  it('fails if decryptWebRtcSignal throws: propagates error; still destroys pake; rtc created but NOT destroyed', async () => {
    const { roomsRepo, pake, webRtc } = mkDeps();
    vi.spyOn(crypto, 'hmacSha256Verify').mockReturnValue(true);
    vi.spyOn(crypto, 'decryptWebRtcSignal').mockImplementation(() => {
      throw new Error('decrypt failed');
    });

    const uc = new JoinRoomUseCase(roomsRepo, pake, webRtc, 10_000);
    await expect(uc.run(roomId)).rejects.toThrow('decrypt failed');

    expect(webRtc.newSession).toHaveBeenCalledWith('responder');
    expect(webRtc.destroy).not.toHaveBeenCalled();
    expect(pake.destroy).toHaveBeenCalledWith('pake_sid_r1');
  });

  it('fails if webRtc.generateAnswer rejects: propagates error; still destroys pake; rtc created but NOT destroyed', async () => {
    const { roomsRepo, pake, webRtc } = mkDeps();
    vi.spyOn(crypto, 'hmacSha256Verify').mockReturnValue(true);
    vi.spyOn(crypto, 'decryptWebRtcSignal').mockReturnValue('{"type":"offer"}');
    (webRtc.generateAnswer as any).mockRejectedValueOnce(new Error('generateAnswer failed'));

    const uc = new JoinRoomUseCase(roomsRepo, pake, webRtc, 10_000);
    await expect(uc.run(roomId)).rejects.toThrow('generateAnswer failed');

    expect(webRtc.destroy).not.toHaveBeenCalled();
    expect(pake.destroy).toHaveBeenCalledWith('pake_sid_r1');
  });

  it('fails if encryptWebRtcSignal throws: propagates error; still destroys pake; does NOT write answer', async () => {
    const { roomsRepo, pake, webRtc } = mkDeps();
    vi.spyOn(crypto, 'hmacSha256Verify').mockReturnValue(true);
    vi.spyOn(crypto, 'decryptWebRtcSignal').mockReturnValue('{"type":"offer"}');
    (webRtc.generateAnswer as any).mockResolvedValueOnce('{"type":"answer"}');
    vi.spyOn(crypto, 'encryptWebRtcSignal').mockImplementation(() => {
      throw new Error('encrypt failed');
    });

    const uc = new JoinRoomUseCase(roomsRepo, pake, webRtc, 10_000);
    await expect(uc.run(roomId)).rejects.toThrow('encrypt failed');

    expect(roomsRepo.writeAnswer).not.toHaveBeenCalled();
    expect(pake.destroy).toHaveBeenCalledWith('pake_sid_r1');
  });

  it('fails if writeAnswer rejects: propagates error; still destroys pake', async () => {
    const { roomsRepo, pake, webRtc } = mkDeps();
    vi.spyOn(crypto, 'hmacSha256Verify').mockReturnValue(true);
    vi.spyOn(crypto, 'decryptWebRtcSignal').mockReturnValue('{"type":"offer"}');
    vi.spyOn(crypto, 'encryptWebRtcSignal').mockReturnValue('w1:ANSWER_ENC');
    (roomsRepo.writeAnswer as any).mockRejectedValueOnce(new Error('writeAnswer failed'));

    const uc = new JoinRoomUseCase(roomsRepo, pake, webRtc, 10_000);
    await expect(uc.run(roomId)).rejects.toThrow('writeAnswer failed');

    expect(pake.destroy).toHaveBeenCalledWith('pake_sid_r1');
  });

  it('fails if waitConnected rejects (ICE/DTLS failure): propagates error; still destroys pake; rtc created but NOT destroyed', async () => {
    const { roomsRepo, pake, webRtc } = mkDeps();
    vi.spyOn(crypto, 'hmacSha256Verify').mockReturnValue(true);
    vi.spyOn(crypto, 'decryptWebRtcSignal').mockReturnValue('{"type":"offer"}');
    vi.spyOn(crypto, 'encryptWebRtcSignal').mockReturnValue('w1:ANSWER_ENC');
    (webRtc.waitConnected as any).mockRejectedValueOnce(new Error('connect failed'));

    const uc = new JoinRoomUseCase(roomsRepo, pake, webRtc, 10_000);
    await expect(uc.run(roomId)).rejects.toThrow('connect failed');

    expect(webRtc.destroy).not.toHaveBeenCalled();
    expect(pake.destroy).toHaveBeenCalledWith('pake_sid_r1');
  });
});
