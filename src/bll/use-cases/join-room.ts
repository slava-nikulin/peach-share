/** biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: <explanation> */
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

const te = new TextEncoder();

export class JoinRoomUseCase {
  private readonly roomsRepo: RoomRepositoryPort;
  private readonly pake: PakePort;
  private readonly webRtc: WebRtcPort;
  private readonly timeoutMs: number;

  constructor(
    roomsRepo: RoomRepositoryPort,
    pake: PakePort,
    webRtc: WebRtcPort,
    timeoutMs: number,
  ) {
    this.roomsRepo = roomsRepo;
    this.pake = pake;
    this.timeoutMs = timeoutMs;
    this.webRtc = webRtc;
  }

  async run(uid: string, roomId: string): Promise<P2pChannel> {
    const sid = this.pake.newSession('responder', base64ToUint8Array(roomId));
    let webRtcSid: WebRtcSessionId = '';

    try {
      // 0) зарегистрироваться как responder (slot + wait state>=2 + probe-read messages)
      await this.roomsRepo.roomJoin(uid, roomId, this.timeoutMs);

      const msgA = await this.roomsRepo.waitA(roomId, this.timeoutMs);
      const msgAbytes = base64ToUint8Array(msgA);

      const msgBbytes = await this.pake.receive(sid, msgAbytes);
      const msgB = uint8ArrayToBase64(msgBbytes, { urlSafe: true });
      await this.roomsRepo.writeB(roomId, msgB);

      const isk = this.pake.exportISK(sid);

      const sidBytes = te.encode(`rooms:pake:v1:${roomId}`);
      const macKey = deriveMacKeyBytes(sidBytes, isk);

      const kcBbytes = hmacSha256(macKey, msgBbytes);
      const kcBB64u = uint8ArrayToBase64(kcBbytes, { urlSafe: true });
      await this.roomsRepo.writeKcB(roomId, kcBB64u);

      const kcAB64u = await this.roomsRepo.waitKcA(roomId, this.timeoutMs);
      const kcAbytes = base64ToUint8Array(kcAB64u);

      const ok = hmacSha256Verify(macKey, msgAbytes, kcAbytes);
      if (!ok) throw new Error('CPace key confirmation failed: invalid kcA');

      webRtcSid = this.webRtc.newSession('responder');

      const offerEnc = await this.roomsRepo.waitOffer(roomId, this.timeoutMs);
      const offer = decryptWebRtcSignal(isk, roomId, 'offer', offerEnc);

      const answer = await this.webRtc.generateAnswer(webRtcSid, offer);
      const answerEnc = encryptWebRtcSignal(isk, roomId, 'answer', answer);

      await this.roomsRepo.writeAnswer(roomId, answerEnc);

      return await this.webRtc.waitConnected(webRtcSid, this.timeoutMs);
    } finally {
      try {
        await this.roomsRepo.finalize(roomId);
      } catch {}
      this.pake.destroy(sid);
    }
  }
}
