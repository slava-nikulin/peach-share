import { resolve } from 'node:path';
import {
  DockerComposeEnvironment,
  type StartedDockerComposeEnvironment,
  Wait,
} from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('Firebase RTDB emulator tests', () => {
  let environment: StartedDockerComposeEnvironment;

  beforeAll(async () => {
    const composeFilePath = resolve(process.cwd(), 'docker');

    environment = await new DockerComposeEnvironment(composeFilePath, 'docker-compose.test.yml')
      .withProfiles('emu')
      .withWaitStrategy(
        'rtdb-emulator-1', // С суффиксом -1 для compose v2
        Wait.forLogMessage(/All emulators ready/) // Точное сообщение из логов
          .withStartupTimeout(60_000), // 60 секунд таймаут
      )
      .up();

    const rtdbContainer = environment.getContainer('rtdb-emulator-1');
    const mappedPort9000 = rtdbContainer.getMappedPort(9000);
    const mappedPort4000 = rtdbContainer.getMappedPort(4000);
    const mappedPort9099 = rtdbContainer.getMappedPort(9099);

    console.log(`RTDB emulator at http://localhost:${mappedPort9000}`);
    console.log(`Emulator UI at http://localhost:${mappedPort4000}`);
    console.log(`Auth emulator at http://localhost:${mappedPort9099}`);
  }, 120_000); // Увеличенный таймаут для build

  afterAll(async () => {
    await environment?.down();
  });

  it('should connect to Firebase emulator', async () => {
    const container = environment.getContainer('rtdb-emulator-1');
    expect(container).toBeDefined();

    const port = container.getMappedPort(9000);
    expect(port).toBeGreaterThan(0);
  });
});
