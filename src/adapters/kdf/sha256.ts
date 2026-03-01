import type { RoomIdKdfPort } from '../../bll/ports/room-id-kdf';

export class Sha256Kdf implements RoomIdKdfPort {
  async deriveRoomId(prs: string, otp: Uint8Array): Promise<Uint8Array> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error('WebCrypto subtle is unavailable.');

    const enc = new TextEncoder();
    const prsBytes = enc.encode(prs);

    const buf = new Uint8Array(prsBytes.length + 1 + otp.length);
    buf.set(prsBytes, 0);
    buf[prsBytes.length] = 0x00;
    buf.set(otp, prsBytes.length + 1);

    const digest = await subtle.digest('SHA-256', buf);
    return new Uint8Array(digest);
  }
}
