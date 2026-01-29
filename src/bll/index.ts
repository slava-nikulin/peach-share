import type { OtpClientPort } from './ports/otp-client';
import type { RoomIdKdfPort } from './ports/room-id-kdf';
import type { RoomRepositoryPort } from './ports/room-repository';

import { InitRoomUseCase } from './use-cases/init-room';

export type BllDeps = {
  roomRepo: RoomRepositoryPort;
  argonAdapter: RoomIdKdfPort;
  otpClient: OtpClientPort;
};

export function createBll(deps: BllDeps) {
  return {
    initRoom: new InitRoomUseCase(deps.roomRepo, deps.argonAdapter, deps.otpClient),
    // тут же другие use cases
  };
}

export type Bll = ReturnType<typeof createBll>;
