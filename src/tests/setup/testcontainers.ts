import { resolve } from 'node:path';
import {
  DockerComposeEnvironment,
  type StartedDockerComposeEnvironment,
  Wait,
} from 'testcontainers';

export interface Emu {
  env: StartedDockerComposeEnvironment;
  host: string;
  stunHost?: string;
  stunPort?: number;
  ports: { db: number; ui: number; auth: number; stun?: number };
}

export async function startEmu(): Promise<Emu> {
  const composeDir = resolve(process.cwd(), 'docker');

  const files = ['docker-compose.base.yml', 'docker-compose.test.yml'];

  const stunHost = process.env.GLOBAL_STUN_HOST;
  const stunPortValue = process.env.GLOBAL_STUN_PORT;
  if (!stunHost || !stunPortValue) {
    throw new Error(
      'GLOBAL_STUN_HOST/PORT are undefined. Ensure global testcontainers setup executed before calling startEmu.',
    );
  }
  const stunPort = Number(stunPortValue);

  const projectName = `emu-${Math.random().toString(16).slice(2, 10)}`;
  const env = await new DockerComposeEnvironment(composeDir, files)
    .withProjectName(projectName)
    .withBuild()
    .withProfiles('rtdb')
    // .withWaitStrategy(`rtdb-emulator-1`, Wait.forLogMessage(/All emulators ready/i))
    .withWaitStrategy(`rtdb-emulator-1`, Wait.forListeningPorts().withStartupTimeout(180_000))
    .up();

  const rtdbContainer = env.getContainer('rtdb-emulator-1');

  return {
    env,
    host: rtdbContainer.getHost(),
    stunHost,
    stunPort,
    ports: {
      db: rtdbContainer.getMappedPort(9000),
      ui: rtdbContainer.getMappedPort(4000),
      auth: rtdbContainer.getMappedPort(9099),
      stun: stunPort,
    },
  };
}

export async function stopEmu(emu?: Emu): Promise<void> {
  if (!emu) return;
  await emu.env.down();
}
