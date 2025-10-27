import { type Database, ref } from 'firebase/database';
import { type RtcEndpoint, WebRTCConnection } from '../../../lib/webrtc';
import { getRoomFirebaseEnv, type RoomFirebaseEnvironment } from '../config/firebase';
import type { Intent, RoomRecord } from '../types';

interface StartRtcDeps {
  env?: RoomFirebaseEnvironment;
  database?: Database;
}

export async function startRTC(
  input: {
    room: RoomRecord;
    intent: Intent;
    encKey: Uint8Array;
    timeoutMs: number;
    stun: RTCIceServer[];
    abortSignal?: AbortSignal;
  },
  deps: StartRtcDeps = {},
): Promise<{ rtcReady: true; endpoint: RtcEndpoint }> {
  const role = input.intent === 'create' ? 'owner' : 'guest';
  const env = deps.env ?? getRoomFirebaseEnv();
  if (!deps.database) env.reconnect();
  const database = deps.database ?? env.db;
  const dbRoomRef = ref(database, `rooms/${input.room.room_id}`);

  const endpoint = await WebRTCConnection.create({
    dbRoomRef,
    role,
    encKey: input.encKey,
    timeoutMs: input.timeoutMs,
    stun: input.stun,
    abortSignal: input.abortSignal,
  });

  try {
    await endpoint.ready;
    return { rtcReady: true, endpoint };
  } catch (e) {
    endpoint.close();
    throw e;
  }
}
