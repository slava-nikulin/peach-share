import { uint8ArrayToBase64 } from 'uint8array-extras';
import type { RoomIntent } from '../../entity/room';
import type { OtpClientPort } from '../ports/otp-client';
import type { RoomIdKdfPort } from '../ports/room-id-kdf';

export interface RoomInitial {
  intent: RoomIntent;
  roomId: string;
}

export interface InitRoomRepositoryPort {
  roomExists(roomId: string): Promise<boolean>;
}

export class InitRoomUseCase {
  private readonly roomsRepo: InitRoomRepositoryPort;
  private readonly kdf: RoomIdKdfPort;
  private readonly otpClient: OtpClientPort;

  constructor(roomsRepo: InitRoomRepositoryPort, kdf: RoomIdKdfPort, otpClient: OtpClientPort) {
    this.roomsRepo = roomsRepo;
    this.kdf = kdf;
    this.otpClient = otpClient;
  }

  async run(prs: string): Promise<RoomInitial> {
    const [rnd0, round] = await this.otpClient.getOtp();

    const id0 = uint8ArrayToBase64(await this.kdf.deriveRoomId(prs, rnd0), { urlSafe: true });
    if (await this.roomsRepo.roomExists(id0)) return { intent: 'join', roomId: id0 };

    const deltas = [1, 2, 3].filter((d) => round - d > 0);

    const otpEntries = await Promise.all(
      deltas.map(async (d) => {
        const [rnd] = await this.otpClient.getOtp(round - d);
        const id = uint8ArrayToBase64(await this.kdf.deriveRoomId(prs, rnd), { urlSafe: true });
        return id;
      }),
    );

    for (const id of otpEntries) {
      if (await this.roomsRepo.roomExists(id)) return { intent: 'join', roomId: id };
    }

    return { intent: 'create', roomId: id0 };
  }
}
