import { createStore } from "solid-js/store";

export type ICECfg = RTCIceServer[];
export type RoomSession = {
  roomId: string;
  peerId: string;
  signalingUrl: string;
  iceServers: ICECfg;
  // runtime:
  ws?: WebSocket;
  peers: Map<string, RTCPeerConnection>;
  dcs: Map<string, RTCDataChannel>;
  bc?: BroadcastChannel; // sync вкладок одной комнаты
  connect: () => Promise<void>;
  disconnect: () => void;
};

type State = {
  sessions: Record<string, RoomSession | undefined>;
};
const [state, setState] = createStore<State>({ sessions: {} });

export const sessionStore = {
  get(roomId: string) { return state.sessions[roomId]; },
  set(roomId: string, s: RoomSession) { setState("sessions", roomId, s); },
  clear(roomId: string) { setState("sessions", roomId, undefined); },
};
