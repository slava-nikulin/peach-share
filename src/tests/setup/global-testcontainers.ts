import { resolve } from 'node:path';
import {
  DockerComposeEnvironment,
  type StartedDockerComposeEnvironment,
  Wait,
} from 'testcontainers';

interface SharedStunState {
  env: StartedDockerComposeEnvironment;
  host: string;
  port: number;
  refs: number;
}

type GlobalWithStun = typeof globalThis & { __peachSharedStun?: SharedStunState };

export default async function globalSetup(): Promise<() => Promise<void>> {
  const g = globalThis as GlobalWithStun;
  if (!g.__peachSharedStun) {
    const composeDir = resolve(process.cwd(), 'docker');
    const projectName = `stun-shared-${Math.random().toString(16).slice(2, 10)}`;
    const env = await new DockerComposeEnvironment(composeDir, ['docker-compose.base.yml'])
      .withProjectName(projectName)
      .withProfiles('stun')
      .withWaitStrategy('stun-1', Wait.forListeningPorts())
      .up();

    const container = env.getContainer('stun-1');
    g.__peachSharedStun = {
      env,
      host: container.getHost(),
      port: container.getMappedPort(3478),
      refs: 1,
    };
  } else {
    g.__peachSharedStun.refs += 1;
  }

  process.env.GLOBAL_STUN_HOST = g.__peachSharedStun.host;
  process.env.GLOBAL_STUN_PORT = String(g.__peachSharedStun.port);

  return async (): Promise<void> => {
    const state = g.__peachSharedStun;
    if (!state) return;

    state.refs -= 1;
    if (state.refs <= 0) {
      delete process.env.GLOBAL_STUN_HOST;
      delete process.env.GLOBAL_STUN_PORT;
      try {
        await state.env.down();
      } finally {
        delete g.__peachSharedStun;
      }
    }
  };
}
