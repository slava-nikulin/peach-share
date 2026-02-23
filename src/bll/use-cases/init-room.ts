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
    const currentRound = this.otpClient.currentRound();

    // Все 3 раунда стартуют параллельно сразу
    const rounds = [currentRound, currentRound - 1, currentRound - 2].filter((r) => r > 0);
    const otpEntries = await Promise.all(rounds.map((r) => this.otpClient.getOtp(r)));

    // current проверяем первым — логика приоритета сохраняется
    const [rnd0] = otpEntries[0];
    const id0 = uint8ArrayToBase64(await this.kdf.deriveRoomId(prs, rnd0), { urlSafe: true });
    if (await this.roomsRepo.roomExists(id0)) return { intent: 'join', roomId: id0 };

    for (const [rnd] of otpEntries.slice(1)) {
      const id = uint8ArrayToBase64(await this.kdf.deriveRoomId(prs, rnd), { urlSafe: true });
      if (await this.roomsRepo.roomExists(id)) return { intent: 'join', roomId: id };
    }

    return { intent: 'create', roomId: id0 };
  }
}
