import { createBll } from '../bll';
import { FirebaseCore } from '../adapters/firebase/core';
import { RtdbRoomRepository } from '../adapters/firebase/rtdb-room-repository';
import { Argon2idBrowserKdf } from '../adapters/argon-kdf/argon2id.browser';
import { DrandOtpClient } from '../adapters/otp-drand';

export async function bootstrap() {
  const core = FirebaseCore.instance;
  await core.init(import.meta.env);

  const roomRepo = new RtdbRoomRepository(core, { basePath: 'rooms' });
  const argonAdapter = new Argon2idBrowserKdf();
  const otpClient = new DrandOtpClient();

  const bll = createBll({ roomRepo, argonAdapter, otpClient });

  return { bll };
}
export type Services = Awaited<ReturnType<typeof bootstrap>>;
