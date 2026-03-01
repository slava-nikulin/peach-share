import { hexToBytes } from '@noble/hashes/utils.js';
import { FastestNodeClient } from 'drand-client';
import type { OtpClientPort } from '../../bll/ports/otp-client';

// Параметры сети 'default' (именно она дает окна по 30 секунд)
const GENESIS_MS = 1595431050_000;
const PERIOD_MS = 30_000;
const CHAIN_HASH = '8990e7a9aaed2ffed73dbd7092123d6f289930540d7651336225dc172e51b2ce';
// Публичный ключ нужен drand-client для проверки подлинности маяка
const PUBLIC_KEY =
  '868f005eb8e6e4ca0a47c8a77ceaa5309a47978a7c71bc5cce96366b5d7a569937c529eeda66c7293784a9402801af31';

const DEFAULT_ENDPOINTS: string[] = [
  'https://api.drand.sh',
  'https://drand.cloudflare.com',
  'https://api2.drand.sh',
  'https://api3.drand.sh',
];

interface DrandOtpClientOpts {
  endpoints?: string[];
}

export class DrandOtpClient implements OtpClientPort {
  private readonly client: FastestNodeClient;

  constructor(opts: DrandOtpClientOpts = {}) {
    // Добавляем хэш сети к URL, чтобы гарантированно стучаться в 'default'
    const urls = (opts.endpoints ?? DEFAULT_ENDPOINTS).map((url) => `${url}/${CHAIN_HASH}`);

    // FastestNodeClient берет на себя логику "гонки" запросов (Promise.any)
    this.client = new FastestNodeClient(urls, {
      chainVerificationParams: {
        chainHash: CHAIN_HASH,
        publicKey: PUBLIC_KEY,
      },
      disableBeaconVerification: false,
      noCache: false,
    });

    // Важно: запускаем клиент, чтобы он в фоне пинговал ноды и знал, какая быстрее
    this.client.start();
  }

  currentRound(): number {
    return Math.floor((Date.now() - GENESIS_MS) / PERIOD_MS) + 1;
  }

  async getOtp(round?: number): Promise<[Uint8Array, number]> {
    const target = round ?? this.currentRound();

    try {
      // 1. запрос к самой быстрой ноде
      // 2. Криптографическая проверка BLS-подпись
      // 3. Get randomness из подписи
      const beacon = await this.client.get(target);

      return [hexToBytes(beacon.randomness), beacon.round];
    } catch (error) {
      if (round !== undefined) throw error;

      // Если мы сами вычислили currentRound и поймали ошибку
      // (скорее всего 404 от CDN на границе 30-секундного окна) — откатываемся назад
      const fallbackBeacon = await this.client.get(target - 1);
      return [hexToBytes(fallbackBeacon.randomness), fallbackBeacon.round];
    }
  }

  // Вызови этот метод при остановке приложения (graceful shutdown),
  // чтобы остановить фоновые проверки таймеров FastestNodeClient
  stop(): void {
    this.client.stop();
  }
}
