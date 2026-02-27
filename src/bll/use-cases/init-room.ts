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
    const otpEntries = await Promise.all(
      rounds.map(async (requestedRound) => {
        const [otp, resolvedRound] = await this.otpClient.getOtp(requestedRound);
        return { otp, requestedRound, resolvedRound };
      }),
    );

    // current проверяем первым — логика приоритета сохраняется
    const top = otpEntries[0];
    const id0 = uint8ArrayToBase64(await this.kdf.deriveRoomId(prs, top.otp), { urlSafe: true });
    const id0Exists = await this.roomsRepo.roomExists(id0);
    if (id0Exists) {
      return { intent: 'join', roomId: id0 };
    }

    for (const entry of otpEntries.slice(1)) {
      const id = uint8ArrayToBase64(await this.kdf.deriveRoomId(prs, entry.otp), { urlSafe: true });
      const exists = await this.roomsRepo.roomExists(id);
      if (exists) {
        return { intent: 'join', roomId: id };
      }
    }

    return { intent: 'create', roomId: id0 };
  }
}
