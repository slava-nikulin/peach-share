import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, afterEach, beforeAll } from 'vitest';

let testEnv: RulesTestEnvironment;

export function getTestEnv(): RulesTestEnvironment {
  if (!testEnv) throw new Error('RulesTestEnvironment not initialized');
  return testEnv;
}

beforeAll(async () => {
  const rulesPath = resolve(process.cwd(), 'docker/config/firebase/database.rules.json');
  const rules = readFileSync(rulesPath, 'utf8');

  testEnv = await initializeTestEnvironment({
    projectId: 'demo-peach-share',
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
