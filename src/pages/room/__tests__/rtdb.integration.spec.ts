import { type Database, get, ref, remove } from 'firebase/database';
import { GenericContainer, Wait } from 'testcontainers/build/index.js';
import type { StartedTestContainer } from 'testcontainers/build/test-container.js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let container: StartedTestContainer;
let host: string;
let port: number;

let createRoomFn: (params: { roomId: string; authId: string }) => Promise<void>;
let db: Database;

const FIREBASE_IMAGE = 'peach-share/firebase-emulator:test';

const createdRoomIds: string[] = [];
let previousWindow: unknown;
let previousSelf: unknown;
let previousDatabaseHost: string | undefined;

interface CommandOptions {
  cwd?: string;
}

const runCommand = async (
  command: string,
  args: string[],
  options?: CommandOptions,
): Promise<void> => {
  // biome-ignore lint/nursery/noUnresolvedImports: Node built-in is available in Vitest's Node environment.
  const { execFile } = await import('node:child_process');
  await new Promise<void>((resolve, reject) => {
    execFile(command, args, { maxBuffer: 10 * 1024 * 1024, ...options }, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
};

const ensureFirebaseImage = async (): Promise<void> => {
  // Using the Docker CLI avoids the archive/tar header failures we hit with
  // GenericContainer.fromDockerfile(...).build() when Vitest streams the build context.
  try {
    await runCommand('docker', ['image', 'inspect', FIREBASE_IMAGE]);
  } catch {
    await runCommand(
      'docker',
      ['build', '-f', 'docker/Dockerfile.firebase', '-t', FIREBASE_IMAGE, 'docker'],
      { cwd: process.cwd() },
    );
  }
};

const startFirebaseContainer = async (): Promise<StartedTestContainer> => {
  await ensureFirebaseImage();
  return new GenericContainer(FIREBASE_IMAGE)
    .withBindMounts([
      {
        source: `${process.cwd()}/docker/config/firebase`,
        target: '/config',
        mode: 'ro',
      },
    ])
    .withEnvironment({
      PROJECT_ID: 'demo-peach-share',
      FIREBASE_EMULATOR_DOWNLOAD_PATH: '/opt/firebase',
      XDG_CACHE_HOME: '/opt/firebase/.cache',
    })
    .withCommand([
      'firebase',
      'emulators:start',
      '--only',
      'database,auth',
      '--project',
      'demo-peach-share',
      '--config',
      '/config/firebase.json',
    ])
    .withExposedPorts(9000, 9099)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
};

const configureProcessEnv = (hostname: string, mappedPort: number): void => {
  previousDatabaseHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  process.env.FIREBASE_DATABASE_EMULATOR_HOST = `${hostname}:${mappedPort}`;

  vi.stubEnv('VITE_USE_EMULATORS', 'true');
  vi.stubEnv('VITE_OFFLINE_MODE', 'false');
  vi.stubEnv('VITE_EMULATOR_RTD_HOST', hostname);
  vi.stubEnv('VITE_EMULATOR_RTD_PORT', String(mappedPort));
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'demo-peach-share');
  vi.stubEnv('MODE', 'emu');
};

const configureWindowGlobals = (hostname: string): void => {
  const globalVars = globalThis as Record<string, unknown>;
  const windowLike = { location: { hostname } };
  previousWindow = globalVars.window;
  previousSelf = globalVars.self;
  globalVars.window = windowLike;
  globalVars.self = windowLike;
};

const loadIntegrationTargets = async (): Promise<void> => {
  ({ createRoom: createRoomFn } = await import('../fsm-actors/create-room.ts'));
  ({ db } = await import('../config/firebase.ts'));
};

beforeAll(async () => {
  try {
    container = await startFirebaseContainer();
    host = container.getHost();
    port = container.getMappedPort(9000);
    configureProcessEnv(host, port);
    configureWindowGlobals(host);
    await loadIntegrationTargets();
  } catch (error) {
    console.error('Failed to initialise Firebase emulator container', error);
    throw error;
  }
}, 240_000);

afterEach(async () => {
  if (!db || createdRoomIds.length === 0) return;
  const ids = createdRoomIds.splice(0);
  await Promise.all(ids.map((roomId) => remove(ref(db, `rooms/${roomId}`))));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  if (typeof previousDatabaseHost === 'undefined') {
    delete process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  } else {
    process.env.FIREBASE_DATABASE_EMULATOR_HOST = previousDatabaseHost;
  }
  const globalVars = globalThis as Record<string, unknown>;
  if (typeof previousWindow === 'undefined') {
    Reflect.deleteProperty(globalVars, 'window');
  } else {
    globalVars.window = previousWindow;
  }
  if (typeof previousSelf === 'undefined') {
    Reflect.deleteProperty(globalVars, 'self');
  } else {
    globalVars.self = previousSelf;
  }
  await container?.stop();
});

const readRoom = async (roomId: string): Promise<Record<string, unknown> | null> => {
  const snapshot = await get(ref(db, `rooms/${roomId}`));
  return snapshot.exists() ? (snapshot.val() as Record<string, unknown>) : null;
};

const freshRoomId = (): string => {
  const id = `room-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  createdRoomIds.push(id);
  return id;
};

describe('createRoom RTDB integration', () => {
  it('creates a room record with owner metadata', async () => {
    const roomId = freshRoomId();
    const authId = `user-${Math.random().toString(16).slice(2, 8)}`;

    await createRoomFn({ roomId, authId });

    const stored = await readRoom(roomId);
    expect(stored).not.toBeNull();
    expect(stored?.owner).toBe(authId);
    expect(stored?.room_id).toBe(roomId);
    expect(typeof stored?.created_at).toBe('number');
    expect(typeof stored?.updated_at).toBe('number');
    expect(stored?.created_at).toBe(stored?.updated_at);
  }, 60_000);

  it('keeps existing data and rejects duplicate creations', async () => {
    const roomId = freshRoomId();
    const authId = `owner-${Math.random().toString(16).slice(2, 8)}`;

    await createRoomFn({ roomId, authId });
    const original = await readRoom(roomId);
    expect(original).not.toBeNull();

    await expect(createRoomFn({ roomId, authId })).rejects.toThrowError('room_already_exists');

    const updated = await readRoom(roomId);
    expect(updated).toEqual(original);
  }, 60_000);
});
