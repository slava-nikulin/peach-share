import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { FirebaseCore } from '../../adapters/firebase/core';

let testEnv: RulesTestEnvironment;

export function getTestEnv(): RulesTestEnvironment {
  if (!testEnv) throw new Error('RulesTestEnvironment not initialized');
  return testEnv;
}

beforeAll(async () => {
  // 1) Инициализируем ваш код (он работает как клиент и подчиняется rules)
  await FirebaseCore.instance.init(import.meta.env);

  // 2) Поднимаем test environment, который умеет clearDatabase() (мимо rules)
  // Порты фиксированные, т.к. вы их публикуете в docker-compose.test.yml как 9000/9099.
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
