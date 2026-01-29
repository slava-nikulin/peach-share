import { resolve } from 'node:path';
import {
  DockerComposeEnvironment,
  type StartedDockerComposeEnvironment,
  Wait,
} from 'testcontainers';

type GlobalWithIT = typeof globalThis & { __itEnv?: StartedDockerComposeEnvironment };

async function waitForFunctionsReady(env: StartedDockerComposeEnvironment): Promise<void> {
  const container = env.getContainer('rtdb-emulator-1');
  const deadline = Date.now() + 120_000; // синхронизируй с testTimeout

  while (Date.now() < deadline) {
    const { exitCode } = await container.exec([
      'sh',
      '-lc',
      `curl -sf http://127.0.0.1:4400/emulators | grep -q '"functions"'`,
    ]);
    if (exitCode === 0) return;
    await new Promise((r) => setTimeout(r, 250));
  }

  throw new Error('Functions emulator did not finish loading in time');
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const g = globalThis as GlobalWithIT;

  const composeDir = resolve(process.cwd(), 'docker');

  const env = await new DockerComposeEnvironment(composeDir, [
    'docker-compose.base.yml',
    'docker-compose.test.yml',
  ])
    .withProjectName('peach-it') // один compose project на весь прогон
    .withProfiles('integration-test') // один профиль
    .withWaitStrategy('rtdb-emulator-1', Wait.forHealthCheck())
    .up();

  await waitForFunctionsReady(env);

  g.__itEnv = env;

  return async () => {
    try {
      await env.down();
    } finally {
      delete g.__itEnv;
    }
  };
}
