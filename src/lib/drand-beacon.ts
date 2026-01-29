// drand-beacon-port.ts
import {
  FastestNodeClient,
  fetchBeaconByTime,
  // типы опций вынесем в any, чтобы не тянуть весь типаж наружу
} from 'drand-client';
import type { BeaconPort } from './ports';

export type DrandNetwork = 'default' | 'quicknet';

interface DrandChainConfig {
  chainHash: string;
  publicKey: string;
}

const DRAND_NETWORKS: Record<DrandNetwork, DrandChainConfig> = {
  default: {
    chainHash: '8990e7a9aaed2ffed73dbd7092123d6f289930540d7651336225dc172e51b2ce',
    publicKey:
      '868f005eb8e6e4ca0a47c8a77ceaa5309a47978a7c71bc5cce96366b5d7a569937c529eeda66c7293784a9402801af31',
  },
  quicknet: {
    chainHash: '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
    publicKey:
      '83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a',
  },
};

export interface DrandBeaconPortConfig {
  /**
   * drand mainnet network to use.
   * default: 'default' (30s period)
   */
  network?: DrandNetwork;

  /**
   * Length of one pepper window in seconds (TOTP-style).
   * default: 30
   */
  windowSeconds?: number;

  /**
   * Optional override of drand HTTP endpoints.
   * By default uses public League of Entropy endpoints.
   */
  urls?: string[];

  /**
   * Turn off signature verification if нужно дебажить/ускорить.
   * Для продакшена лучше оставить false.
   */
  disableVerification?: boolean;
}

/**
 * DrandBeaconPort — адаптер drand randomness beacon → наш BeaconPort.
 *
 * SOLID:
 * - SRP: класс отвечает только за получение pepper из drand.
 * - OCP: конфиг расширяемый (windowSeconds, сеть, url’ы).
 * - DIP: работает через абстрактный BeaconPort, верхнему уровню всё равно, что внутри drand.
 */
export class DrandBeaconPort implements BeaconPort {
  private readonly network: DrandNetwork;
  private readonly windowSeconds: number;
  private readonly chainConfig: DrandChainConfig;
  private readonly urls: string[];
  private readonly options: any;
  private client: FastestNodeClient | null = null;
  private readonly encoder = new TextEncoder();

  constructor(config: DrandBeaconPortConfig = {}) {
    this.network = config.network ?? 'default';
    this.windowSeconds = config.windowSeconds ?? 30;

    if (this.windowSeconds <= 0) {
      throw new Error('windowSeconds must be positive');
    }

    this.chainConfig = DRAND_NETWORKS[this.network];

    const baseUrls = config.urls ?? [
      'https://api.drand.sh',
      'https://api2.drand.sh',
      'https://api3.drand.sh',
      'https://drand.cloudflare.com',
    ];

    // Для quicknet нужно дописать /<chainHash> к каждому URL
    this.urls =
      this.network === 'quicknet'
        ? baseUrls.map((url) => `${url}/${this.chainConfig.chainHash}`)
        : baseUrls;

    this.options = {
      disableBeaconVerification: config.disableVerification ?? false,
      noCache: false,
      // Подписываемся только если верификация включена (как рекомендуют в доке)
      chainVerificationParams: config.disableVerification
        ? undefined
        : {
            chainHash: this.chainConfig.chainHash,
            publicKey: this.chainConfig.publicKey,
          },
    };
  }

  /**
   * Ленивая инициализация клиента drand.
   * FastestNodeClient умеет сам выбирать самый быстрый endpoint.
   */
  private getClient(): FastestNodeClient {
    if (!this.client) {
      // В React-примере drand добавляют эти заголовки, оставлю их,
      // хотя на практике это не обязательно.
      const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': 'true',
      };

      this.client = new FastestNodeClient(this.urls, this.options, { headers });
      this.client.start();
    }

    return this.client;
  }

  /**
   * Главный метод порта: получить pepper и индекс окна (epoch).
   */
  async getPepperForCurrentEpoch(): Promise<{
    pepper: Uint8Array;
    epoch: number;
  }> {
    const client = this.getClient();

    const windowMs = this.windowSeconds * 1000;
    const nowMs = Date.now(); // UTC, общий для всех

    const epoch = Math.floor(nowMs / windowMs);
    const anchorTimeMs = epoch * windowMs;

    // drand-client сам вычисляет нужный round для anchorTimeMs и берёт beacon
    const beacon = await fetchBeaconByTime(client, anchorTimeMs);

    // randomness из drand — hex-строка
    const randomnessBytes = this.hexToBytes(beacon.randomness);
    const epochBytes = this.encoder.encode(epoch.toString(10));

    const input = new Uint8Array(randomnessBytes.length + epochBytes.length);
    input.set(randomnessBytes, 0);
    input.set(epochBytes, randomnessBytes.length);

    const pepper = await this.sha256(input);

    return { pepper, epoch };
  }

  /**
   * Явный stop, чтобы можно было аккуратно почистить ресурсы
   * (например, в onCleanup SolidJS).
   */
  stop(): void {
    if (this.client) {
      this.client.stop();
      this.client = null;
    }
  }

  // ===== Вспомогательные методы =====

  private async sha256(input: Uint8Array): Promise<Uint8Array> {
    if (!globalThis.crypto?.subtle) {
      throw new Error('Web Crypto SubtleCrypto API is not available in this environment');
    }

    // Здесь тип ровно Uint8Array, который совместим с BufferSource.
    const digest = await globalThis.crypto.subtle.digest('SHA-256', input);
    return new Uint8Array(digest);
  }

  private hexToBytes(hex: string): Uint8Array {
    const normalized = hex.startsWith('0x') ? hex.slice(2) : hex;

    if (normalized.length % 2 !== 0) {
      throw new Error('Invalid hex string length');
    }

    const bytes = new Uint8Array(normalized.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      const byte = normalized.slice(i * 2, i * 2 + 2);
      bytes[i] = Number.parseInt(byte, 16);
    }
    return bytes;
  }
}
