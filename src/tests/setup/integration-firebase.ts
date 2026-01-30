import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { get, ref } from 'firebase/database';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { FirebaseCore } from '../../adapters/firebase/core';

let testEnv: RulesTestEnvironment;

export async function waitForRoom(params: {
  uid: string;
  roomId: string;
  timeoutMs?: number;
  intervalMs?: number;
}) {
  const { uid, roomId, timeoutMs = 10_000, intervalMs = 100 } = params;

  const env = getTestEnv();
  const db = env.authenticatedContext(uid).database();

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const snap = await get(ref(db, `/rooms/${roomId}`));
    const val = snap.val();
    if (val) return val;
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`Room was not created within ${timeoutMs}ms: ${roomId}`);
}

export function getTestEnv(): RulesTestEnvironment {
  if (!testEnv) throw new Error('RulesTestEnvironment not initialized');
  return testEnv;
}

beforeAll(async () => {
  await FirebaseCore.instance.init(import.meta.env);

  // Порты фиксированные, т.к. вы их публикуете в docker-compose.test.yml как 9000/9099.
  const rulesPath = resolve(process.cwd(), 'docker/config/firebase/database.rules.json');
  const rules = readFileSync(rulesPath, 'utf8');

  testEnv = await initializeTestEnvironment({
    projectId: import.meta.env.VITE_EMULATOR_RTD_NS,
    database: {
      host: '127.0.0.1',
      port: 9000,
      rules,
    },
  });
});

afterEach(async () => {
  await testEnv.clearDatabase();
});

afterAll(async () => {
  await testEnv.cleanup();
});
