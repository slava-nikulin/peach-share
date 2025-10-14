import { resolve } from 'node:path';
import {
  DockerComposeEnvironment,
  type StartedDockerComposeEnvironment,
  Wait,
} from 'testcontainers';

export interface Emu {
  env: StartedDockerComposeEnvironment;
  host: string;
  ports: { db: number; ui: number; auth: number };
}

export async function startEmu(): Promise<Emu> {
  const composeDir = resolve(process.cwd(), 'docker');

  const files = ['docker-compose.base.yml', 'docker-compose.test.yml'];

  const env = await new DockerComposeEnvironment(composeDir, files)
    .withBuild()
    .withProfiles('emu')
    // .withWaitStrategy(`rtdb-emulator-1`, Wait.forLogMessage(/All emulators ready/i))
    .withWaitStrategy(`rtdb-emulator-1`, Wait.forListeningPorts())
    .up();

  const c = env.getContainer(`rtdb-emulator-1`);
  return {
    env,
    host: c.getHost(),
    ports: { db: c.getMappedPort(9000), ui: c.getMappedPort(4000), auth: c.getMappedPort(9099) },
  };
}

export async function stopEmu(env: StartedDockerComposeEnvironment): Promise<void> {
  await env.down();
}
