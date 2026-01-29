import { ref } from 'firebase/database';
import { type RtcEndpoint, WebRTCConnection } from '../../../lib/webrtc';
import type { RtdbConnector } from '../lib/RtdbConnector';
import type { Intent, RoomRecord } from '../types';
export async function startRTC(input: {
  room: RoomRecord;
  intent: Intent;
  encKey: Uint8Array;
  timeoutMs: number;
  stun: RTCIceServer[];
  abortSignal?: AbortSignal;
  rtdb: RtdbConnector;
}): Promise<{ rtcReady: true; endpoint: RtcEndpoint }> {
  const role = input.intent === 'create' ? 'owner' : 'guest';
  const database = input.rtdb.connect();
  input.rtdb.ensureOnline();
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
