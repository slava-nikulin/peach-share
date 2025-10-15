import { type Accessor, createSignal, type Setter } from 'solid-js';

export type Intent = 'create' | 'join';

export interface RoomRecord {
  room_id: string;
  owner: string;
  guestId?: string;
  created_at: number | object;
  updated_at: number | object;

  pake_state?: 'init' | 'keys_exchanged' | 'verified';
  pake_data?: unknown;
}

export interface RoomVM {
  isRoomCreated: Accessor<boolean>;
  isRtcReady: Accessor<boolean>;
  isCleanupDone: Accessor<boolean>;
  sas: Accessor<string | null>;
  authId: Accessor<string | null>;
  pakeKey: Accessor<string | null>;
  secret: Accessor<string | null>;
  setRoomCreated: Setter<boolean>;
  setRtcReady: Setter<boolean>;
  setCleanupDone: Setter<boolean>;
  setSas: Setter<string | null>;
  setAuthId: Setter<string | null>;
  setPakeKey: Setter<string | null>;
  setSecret: Setter<string | null>;
}

export function createRoomVM(): RoomVM {
  const [isRoomCreated, setRoomCreated] = createSignal(false);
  const [isRtcReady, setRtcReady] = createSignal(false);
  const [isCleanupDone, setCleanupDone] = createSignal(false);

  const [secret, setSecret] = createSignal<string | null>(null);
  const [authId, setAuthId] = createSignal<string | null>(null);
  const [pakeKey, setPakeKey] = createSignal<string | null>(null);
  const [sas, setSas] = createSignal<string | null>(null);

  return {
    isRoomCreated,
    isRtcReady,
    isCleanupDone,
    sas,
    authId,
    pakeKey,
    secret,
    setRoomCreated,
    setRtcReady,
    setCleanupDone,
    setSas,
    setAuthId,
    setPakeKey,
    setSecret,
  };
}
