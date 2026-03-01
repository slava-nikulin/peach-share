import { base64ToUint8Array, uint8ArrayToBase64 } from 'uint8array-extras';
import {
  decryptWebRtcSignal,
  deriveMacKeyBytes,
  encryptWebRtcSignal,
  hmacSha256,
  hmacSha256Verify,
} from '../../lib/crypto';
import type { P2pChannel } from '../ports/p2p-channel';
import type { PakePort } from '../ports/pake';
import type { RoomRepositoryPort } from '../ports/room-repository';
import type { WebRtcPort, WebRtcSessionId } from '../ports/webrtc';

const te: TextEncoder = new TextEncoder();

export class CreateRoomUseCase {
  private readonly roomsRepo: RoomRepositoryPort;
  private readonly pake: PakePort;
  private readonly timeoutMs: number;
  private readonly rtcTimeoutMs: number;
  private readonly webRtc: WebRtcPort;
  private readonly waitSecondSideMs: number;

  constructor(
    roomsRepo: RoomRepositoryPort,
    pake: PakePort,
    webRtc: WebRtcPort,
    timeoutMs: number,
    waitSecondSideMs: number = 30_000,
    rtcTimeoutMs: number = timeoutMs,
  ) {
    this.roomsRepo = roomsRepo;
    this.pake = pake;
    this.timeoutMs = timeoutMs;
    this.rtcTimeoutMs = rtcTimeoutMs;
    this.webRtc = webRtc;
    this.waitSecondSideMs = waitSecondSideMs;
  }

  async run(uid: string, roomId: string): Promise<P2pChannel> {
    const sid = this.pake.newSession('initiator', base64ToUint8Array(roomId));

    let webRtcSid: WebRtcSessionId = '';
    try {
      await this.roomsRepo.roomCreate(uid, roomId, this.waitSecondSideMs);

      const msgAbytes = await this.pake.start(sid);
      const msgA = uint8ArrayToBase64(msgAbytes, { urlSafe: true });
      await this.roomsRepo.writeA(roomId, msgA);

      const msg_b = await this.roomsRepo.waitB(roomId, this.waitSecondSideMs); // ждем пока вторая сторона откроет страницу и введет prs.
      const msgBbytes = base64ToUint8Array(msg_b);

      await this.pake.receive(sid, msgBbytes);

      const isk = this.pake.exportISK(sid);

      // mac_key = SHA-512("CPaceMac" || sid || ISK)
      const sidBytes = te.encode(`rooms:pake:v1:${roomId}`);
      const macKey = deriveMacKeyBytes(sidBytes, isk);

      // kcA = HMAC(macKey, Ya)
      const kcABytes = hmacSha256(macKey, msgAbytes);
      const kcAB64u = uint8ArrayToBase64(kcABytes, { urlSafe: true });
      await this.roomsRepo.writeKcA(roomId, kcAB64u);

      // wait kcB and verify it against Yb
      const kcBB64u = await this.roomsRepo.waitKcB(roomId, this.timeoutMs);
      const kcBbytes = base64ToUint8Array(kcBB64u);

      const ok = hmacSha256Verify(macKey, msgBbytes, kcBbytes);
      if (!ok) throw new Error('CPace key confirmation failed: invalid kcB');

      webRtcSid = this.webRtc.newSession('initiator');

      // 1) Сгенерировать offer (opaque JSON string) и записать в RTDB
      const offer = await this.webRtc.generateOffer(webRtcSid);
      const offerEnc = encryptWebRtcSignal(isk, roomId, 'offer', offer);
      await this.roomsRepo.writeOffer(roomId, offerEnc);

      // 2) Подождать answer и принять его
      const answerEnc = await this.roomsRepo.waitAnswer(roomId, this.rtcTimeoutMs);
      const answer = decryptWebRtcSignal(isk, roomId, 'answer', answerEnc);
      this.webRtc.acceptAnswer(webRtcSid, answer);

      // 3) Дождаться connect
      const channel = await this.webRtc.waitConnected(webRtcSid, this.rtcTimeoutMs);
      return channel;
    } catch (err) {
      try {
        this.webRtc.destroy(webRtcSid);
      } catch {}
      throw err;
    } finally {
      try {
        await this.roomsRepo.finalize(roomId);
      } catch {}
      this.pake.destroy(sid);
    }
  }
}
