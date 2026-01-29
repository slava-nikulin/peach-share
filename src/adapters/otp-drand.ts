import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes } from '@noble/hashes/utils.js';
import type { OtpClientPort } from '../bll/ports/otp-client';

type DrandV2Round = {
  round: number;
  signature: string; // hex
};

type DrandOtpClientOpts = {
  baseUrl?: string;
  beaconId?: string;
  timeoutMs?: number;
};

export class DrandOtpClient implements OtpClientPort {
  private readonly opts: DrandOtpClientOpts;

  constructor(opts: DrandOtpClientOpts = {}) {
    this.opts = opts;
  }

  async getOtp(round?: number): Promise<[Uint8Array, number]> {
    const {
      baseUrl = 'https://api.drand.sh',
      beaconId = 'quicknet',
      timeoutMs = 8_000,
    } = this.opts;

    const path =
      round === undefined
        ? `/v2/beacons/${beaconId}/rounds/latest` // v2 latest [web:146]
        : `/v2/beacons/${beaconId}/rounds/${round}`; // v2 конкретный round [web:135]

    const entry = await getJson<DrandV2Round>(baseUrl, path, timeoutMs);
    const randomness = randomnessFromSignatureHex(entry.signature);

    return [randomness, entry.round];
  }
}

function randomnessFromSignatureHex(signatureHex: string): Uint8Array {
  const clean = signatureHex.startsWith('0x') ? signatureHex.slice(2) : signatureHex;
  return sha256(hexToBytes(clean));
}

async function getJson<T>(baseUrl: string, path: string, timeoutMs: number): Promise<T> {
  const url = new URL(path, baseUrl).toString();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`drand HTTP ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}
