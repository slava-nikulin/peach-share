import type { OtpClientPort } from '../../bll/ports/otp-client';

const MAX_ROUNDS_DEFAULT = 3;

async function sha256Bytes(msg: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const data = enc.encode(msg);

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('WebCrypto subtle is unavailable (requires secure context / modern runtime).');
  }

  const digest = await subtle.digest('SHA-256', data);
  return new Uint8Array(digest);
}

export class OfflineOtpClient implements OtpClientPort {
  private readonly rounds: number;

  constructor(rounds: number = MAX_ROUNDS_DEFAULT) {
    this.rounds = rounds;
  }

  currentRound(): number {
    // UseCase возьмёт current, current-1, current-2 (и отфильтрует > 0)
    return this.rounds;
  }

  async getOtp(requestedRound: number): Promise<[Uint8Array, number]> {
    if (!Number.isFinite(requestedRound) || requestedRound <= 0) {
      throw new RangeError('requestedRound must be > 0');
    }

    // детерминированно и одинаково для всех клиентов
    const otp = await sha256Bytes(`offline-otp:${requestedRound}`);
    return [otp, requestedRound];
  }
}
