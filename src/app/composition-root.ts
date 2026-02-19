/** biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: <explanation> */
import type { FirebaseOptions } from 'firebase/app';

import { Argon2idBrowserKdf } from '../adapters/argon-kdf/argon2id.browser';
import { createEmulatorRtdbConnection } from '../adapters/firebase/emulator';
import { createProdRtdbConnection } from '../adapters/firebase/prod';
import { RtdbOnlineRunner } from '../adapters/firebase/rtdb-online-runner';
import { RtdbRoomRepository } from '../adapters/firebase/rtdb-room-repository';
import { DrandOtpClient } from '../adapters/otp-drand';
import { CpaceEngine } from '../adapters/pake-engine/cpace';
import { SimplePeerEngine } from '../adapters/webrtc-engine/simple-peer';
import { CreateRoomUseCase } from '../bll/use-cases/create-room';
import { InitRoomUseCase } from '../bll/use-cases/init-room';
import { JoinRoomUseCase } from '../bll/use-cases/join-room';

function must(env: ImportMetaEnv, key: string): string {
  const v = (env as unknown as Record<string, string | undefined>)[key];
  if (!v) throw new Error(`Missing required env: ${key}`);
  return v;
}

export async function compose() {
  const env = import.meta.env;
  const useEmulators = env.VITE_USE_EMULATORS === 'true';

  const firebaseOptions: FirebaseOptions = useEmulators
    ? {
        apiKey: env.VITE_FIREBASE_API_KEY || 'dev-key',
        projectId: env.VITE_FIREBASE_PROJECT_ID || 'demo',
        appId: env.VITE_FIREBASE_APP_ID || 'demo-app',
        authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'localhost',
        databaseURL: env.VITE_FIREBASE_DATABASE_URL,
      }
    : {
        apiKey: must(env, 'VITE_FIREBASE_API_KEY'),
        projectId: must(env, 'VITE_FIREBASE_PROJECT_ID'),
        appId: must(env, 'VITE_FIREBASE_APP_ID'),
        authDomain: must(env, 'VITE_FIREBASE_AUTH_DOMAIN'),
        databaseURL: env.VITE_FIREBASE_DATABASE_URL,
      };

  const firebase = useEmulators
    ? await createEmulatorRtdbConnection({
        app: { name: 'main', options: firebaseOptions },
        emulator: {
          host: (env.VITE_EMULATOR_HOST || location.hostname).trim(),
          authPort: Number(env.VITE_EMULATOR_AUTH_PORT || 9099),
          rtdbPort: Number(env.VITE_EMULATOR_RTDB_PORT || 9000),
          protocol: location.protocol === 'https:' ? 'https:' : 'http:',
          namespace: env.VITE_EMULATOR_RTD_NS || (firebaseOptions.projectId as string) || 'demo',
          forceSecureRepo: env.VITE_USE_LOCAL_SECURED_CONTEXT === 'true',
        },
      })
    : await createProdRtdbConnection({
        app: { name: 'main', options: firebaseOptions },
        appCheck: env.VITE_APPCHECK_SITEKEY
          ? { siteKey: env.VITE_APPCHECK_SITEKEY, debugToken: env.VITE_APPCHECK_DEBUG_TOKEN }
          : undefined,
      });

  // Adapters
  const roomRepo = new RtdbRoomRepository(firebase.db);
  const argonAdapter = new Argon2idBrowserKdf();
  const otpClient = new DrandOtpClient();
  const pake = new CpaceEngine();
  const webrtc = new SimplePeerEngine();

  // Usecases (core)
  const initRoomCore = new InitRoomUseCase(roomRepo, argonAdapter, otpClient);
  const createRoomCore = new CreateRoomUseCase(roomRepo, pake, webrtc, 5000, 30000);
  const joinRoomCore = new JoinRoomUseCase(roomRepo, pake, webrtc, 5000);

  // Runners (policy)
  const onlineRunner = new RtdbOnlineRunner(firebase.db);

  // BLL (application boundary)
  const uid = firebase.auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated: auth.currentUser is null');

  const bll = {
    initRoom: {
      run: (prs: string) => onlineRunner.run(() => initRoomCore.run(prs)),
    },
    createRoom: {
      run: (roomId: string) => {
        return onlineRunner.run(() => createRoomCore.run(uid, roomId));
      },
    },
    joinRoom: {
      run: (roomId: string) => {
        return onlineRunner.run(() => joinRoomCore.run(uid, roomId));
      },
    },
  } as const;

  return { bll };
}

export type Bll = Awaited<ReturnType<typeof compose>>['bll'];
