/** biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: <explanation> */
import http from 'node:http';
import { afterAll, beforeAll } from 'vitest';

type DrandMockState = {
  baseUrl: string;
  beaconId: string;
  latestRound: number;
  requests: string[];
};

type GlobalWithDrand = typeof globalThis & { __drandMock?: DrandMockState };

function signatureHexForRound(round: number): string {
  // Drand signature в реальности длиннее, но клиенту всё равно — он sha256(hexToBytes(signature)).
  // Сделаем 96 байт (192 hex chars), детерминированно от round.
  const buf = Buffer.alloc(96, round & 0xff);
  return '0x' + buf.toString('hex');
}

let server: http.Server;

beforeAll(async () => {
  const g = globalThis as GlobalWithDrand;

  const state: DrandMockState = {
    baseUrl: '',
    beaconId: 'quicknet',
    latestRound: 42,
    requests: [],
  };

  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    state.requests.push(`${req.method ?? 'GET'} ${url.pathname}`);

    const respond = (round: number) => {
      const body = JSON.stringify({
        round,
        signature: signatureHexForRound(round),
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(body);
    };

    if ((req.method ?? 'GET') !== 'GET') {
      res.writeHead(405);
      return res.end();
    }

    // /v2/beacons/:beaconId/rounds/latest
    // /v2/beacons/:beaconId/rounds/:round
    const mLatest = url.pathname.match(/^\/v2\/beacons\/([^/]+)\/rounds\/latest$/);
    if (mLatest) {
      // beaconId можно проверить, но обычно не обязательно
      return respond(state.latestRound);
    }

    const mRound = url.pathname.match(/^\/v2\/beacons\/([^/]+)\/rounds\/(\d+)$/);
    if (mRound) {
      const round = Number(mRound[2]);
      // Разрешаем latest и 3 предыдущих
      const ok = round >= state.latestRound - 3 && round <= state.latestRound;
      if (!ok) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('round out of range');
      }
      return respond(round);
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Failed to bind drand-mock');

  state.baseUrl = `http://127.0.0.1:${addr.port}`;
  g.__drandMock = state;

  // Если где-то хочешь читать из env — можно сохранить:
  process.env.VITE_DRAND_HTTP_BASE_URL = state.baseUrl;
});

afterAll(async () => {
  const g = globalThis as GlobalWithDrand;
  delete g.__drandMock;

  await new Promise<void>((resolve) => server.close(() => resolve()));
});
