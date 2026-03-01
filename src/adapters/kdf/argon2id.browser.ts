import { loadWasm as loadArgon2idWasm } from '../../argon2id.vite';
import type { RoomIdKdfPort } from '../../bll/ports/room-id-kdf';

export class Argon2idBrowserKdf implements RoomIdKdfPort {
  private argon2idPromise = loadArgon2idWasm(); // кешируем инстанс

  async deriveRoomId(prs: string, salt: Uint8Array): Promise<Uint8Array> {
    const argon2id = await this.argon2idPromise;

    const out = argon2id({
      password: new TextEncoder().encode(prs),
      salt: salt,
      parallelism: 1,
      passes: 3,
      memorySize: 64 * 1024, // KiB
      tagLength: 32, // bytes
    });

    return out;
  }
}
