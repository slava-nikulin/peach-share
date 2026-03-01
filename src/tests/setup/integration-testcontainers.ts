import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { type Database, type DataSnapshot, get, onValue, ref, set } from 'firebase/database';
import {
  DockerComposeEnvironment,
  type StartedDockerComposeEnvironment,
  Wait,
} from 'testcontainers';

type GlobalWithIT = typeof globalThis & { __itEnv?: StartedDockerComposeEnvironment };
interface RulesDisabledContext {
  database(): unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitInfoConnected(db: Database, timeoutMs: number): Promise<void> {
  const r = ref(db, '.info/connected');

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let unsub: (() => void) | undefined;

    const cleanup = (): void => {
      try {
        unsub?.();
      } catch {
        // ignore
      }
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Timed out waiting for .info/connected=true after ${timeoutMs}ms`));
    }, timeoutMs);

    const onSnap = (s: DataSnapshot): void => {
      if (settled) return;
      if (s.exists() && s.val() === true) {
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve();
      }
    };

    unsub = onValue(r, onSnap, (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(err);
    });
  });
}

async function waitForFirebaseClientReady(): Promise<void> {
  const rulesPath = resolve(process.cwd(), 'docker/config/firebase/database.rules.json');
  const rules = readFileSync(rulesPath, 'utf8');
  let probeEnv: RulesTestEnvironment | undefined;

  try {
    probeEnv = await initializeTestEnvironment({
      projectId: 'demo-peach-share',
      database: {
        host: '127.0.0.1',
        port: 9000,
        rules,
      },
    });

    const probeDb = probeEnv.authenticatedContext('it_probe').database() as unknown as Database;
    await waitInfoConnected(probeDb, 30_000);

    const startedAt = Date.now();
    const timeoutMs = 30_000;
    let attempt = 0;

    while (Date.now() - startedAt < timeoutMs) {
      attempt += 1;
      const uid = `it_probe_${Date.now()}_${attempt}`;
      const roomId = `it_probe_room_${Date.now()}_${attempt}`;

      await probeEnv.withSecurityRulesDisabled(async (ctx: RulesDisabledContext) => {
        const adminDb = ctx.database() as unknown as Database;
        await set(ref(adminDb, `/${uid}/create`), {
          room_id: roomId,
          created_at: Date.now(),
        });
      });

      const perAttemptDeadline = Date.now() + 1_000;
      let created = false;

      while (Date.now() < perAttemptDeadline) {
        await probeEnv.withSecurityRulesDisabled(async (ctx: RulesDisabledContext) => {
          const adminDb = ctx.database() as unknown as Database;
          const snap = await get(ref(adminDb, `/rooms/${roomId}/meta/state`));
          const state = snap.exists() ? Number(snap.val()) : Number.NaN;
          created = Number.isFinite(state) && state >= 1;
        });

        if (created) break;
        await sleep(100);
      }

      await probeEnv.withSecurityRulesDisabled(async (ctx: RulesDisabledContext) => {
        const adminDb = ctx.database() as unknown as Database;
        await set(ref(adminDb, `/${uid}`), null);
        await set(ref(adminDb, `/rooms/${roomId}`), null);
      });

      if (created) return;
      await sleep(250);
    }

    throw new Error(`Timed out waiting for registerCreator trigger readiness after ${timeoutMs}ms`);
  } finally {
    await probeEnv?.cleanup();
  }
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const g = globalThis as GlobalWithIT;
  const keepDocker = process.env.IT_KEEP_DOCKER === '1';

  const composeDir = resolve(process.cwd(), 'docker');
  const functionsDir = resolve(process.cwd(), 'functions');
  const emulatorEnvLocalPath = resolve(functionsDir, '.env.local');
  let createdEmulatorEnvLocal = false;

  if (!existsSync(emulatorEnvLocalPath)) {
    writeFileSync(emulatorEnvLocalPath, 'PEACH_FUNCTION_REGION=us-central1\n', {
      encoding: 'utf8',
    });
    createdEmulatorEnvLocal = true;
  }

  execFileSync('pnpm', ['--dir', functionsDir, 'build'], {
    cwd: process.cwd(),
    stdio: 'inherit',
  });

  const env = await new DockerComposeEnvironment(composeDir, [
    'docker-compose.base.yml',
    'docker-compose.test.yml',
  ])
    .withProjectName('peach-it')
    .withProfiles('integration-test')
    .withWaitStrategy('rtdb-emulator-1', Wait.forHealthCheck())
    .up();

  await waitForFirebaseClientReady();

  g.__itEnv = env;

  return async (): Promise<void> => {
    try {
      if (!keepDocker) {
        await env.down();
      }
      if (createdEmulatorEnvLocal && existsSync(emulatorEnvLocalPath)) {
        unlinkSync(emulatorEnvLocalPath);
      }
    } finally {
      delete g.__itEnv;
    }
  };
}
