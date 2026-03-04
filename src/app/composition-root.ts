import type { FirebaseOptions } from 'firebase/app';
import { DrandOtpClient } from '../adapters/beacon/otp-drand';
import { createEmulatorRtdbConnection } from '../adapters/firebase/emulator';
import { createProdRtdbConnection } from '../adapters/firebase/prod';
import { RtdbOnlineRunner } from '../adapters/firebase/rtdb-online-runner';
import { RtdbRoomRepository } from '../adapters/firebase/rtdb-room-repository';
import { Argon2idBrowserKdf } from '../adapters/kdf/argon2id.browser';
import { CpaceEngine } from '../adapters/pake-engine/cpace';
import type { P2pChannel } from '../bll/ports/p2p-channel';
import { CreateRoomUseCase } from '../bll/use-cases/create-room';
import type { RoomInitial } from '../bll/use-cases/init-room';
import { InitRoomUseCase } from '../bll/use-cases/init-room';
import { JoinRoomUseCase } from '../bll/use-cases/join-room';

function must(env: ImportMetaEnv, key: string): string {
  const v = (env as unknown as Record<string, string | undefined>)[key];
  if (!v) throw new Error(`Missing required env: ${key}`);
  return v;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: todo refactor
export async function compose(): Promise<{
  bll: {
    initRoom: { run: (prs: string) => Promise<RoomInitial> };
    createRoom: { run: (roomId: string) => Promise<P2pChannel> };
    joinRoom: { run: (roomId: string) => Promise<P2pChannel> };
  };
}> {
  const env = import.meta.env;
  const useEmulators = env.VITE_USE_EMULATORS === 'true';
  const forceRtdbWebSockets = env.VITE_FIREBASE_FORCE_WEBSOCKETS === 'true';
  const isOffline = import.meta.env.MODE === 'offline';

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
          forceWebSockets: forceRtdbWebSockets,
        },
      })
    : await createProdRtdbConnection({
        app: { name: 'main', options: firebaseOptions },
        forceWebSockets: forceRtdbWebSockets,
        appCheck: env.VITE_APPCHECK_SITEKEY
          ? { siteKey: env.VITE_APPCHECK_SITEKEY, debugToken: env.VITE_APPCHECK_DEBUG_TOKEN }
          : undefined,
      });

  // Adapters
  const roomRepo = new RtdbRoomRepository(firebase.db);

  const kdfAdapter = isOffline
    ? new (await import('../adapters/kdf/sha256')).Sha256Kdf()
    : new Argon2idBrowserKdf();

  const otpClient = isOffline
    ? new (await import('../adapters/beacon/offline-otp-client')).OfflineOtpClient()
    : new DrandOtpClient();

  // Usecases (core)
  const initRoomCore = new InitRoomUseCase(roomRepo, kdfAdapter, otpClient);

  let roomFlowsPromise:
    | Promise<{ createRoomCore: CreateRoomUseCase; joinRoomCore: JoinRoomUseCase }>
    | undefined;

  const getRoomFlows = async (): Promise<{
    createRoomCore: CreateRoomUseCase;
    joinRoomCore: JoinRoomUseCase;
  }> => {
    if (!roomFlowsPromise) {
      roomFlowsPromise = (async () => {
        const { SimplePeerEngine } = await import('../adapters/webrtc-engine/simple-peer');
        const pake = new CpaceEngine();

        const webrtc = new SimplePeerEngine();
        const pakeTimeoutMs = 5_000;
        const rtcTimeoutMs = 30_000;
        const waitSecondSideMs = 90_000;

        return {
          createRoomCore: new CreateRoomUseCase(
            roomRepo,
            pake,
            webrtc,
            pakeTimeoutMs,
            waitSecondSideMs,
            rtcTimeoutMs,
          ),
          joinRoomCore: new JoinRoomUseCase(roomRepo, pake, webrtc, pakeTimeoutMs, rtcTimeoutMs),
        };
      })();
    }

    return await roomFlowsPromise;
  };

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
        return onlineRunner.run(async () => {
          const { createRoomCore } = await getRoomFlows();
          return await createRoomCore.run(uid, roomId);
        });
      },
    },
    joinRoom: {
      run: (roomId: string) => {
        return onlineRunner.run(async () => {
          const { joinRoomCore } = await getRoomFlows();
          return await joinRoomCore.run(uid, roomId);
        });
      },
    },
  } as const;

  return { bll };
}

export type Bll = Awaited<ReturnType<typeof compose>>['bll'];
