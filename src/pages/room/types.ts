import { type Accessor, createSignal, type Setter } from 'solid-js';

export type Intent = 'create' | 'join';
export interface RoomVM {
  isRoomCreated: Accessor<boolean>;
  isRtcReady: Accessor<boolean>;
  isCleanupDone: Accessor<boolean>;
  sas: Accessor<string | null>;
  authId: Accessor<string | null>;
  pakeKey: Accessor<string | null>;
  roomId: Accessor<string | null>;
  setRoomCreated: Setter<boolean>;
  setRtcReady: Setter<boolean>;
  setCleanupDone: Setter<boolean>;
  setSas: Setter<string | null>;
  setAuthId: Setter<string | null>;
  setPakeKey: Setter<string | null>;
  setRoomId: Setter<string | null>;
}

export function createRoomVM(): RoomVM {
  const [isRoomCreated, setRoomCreated] = createSignal(false);
  const [isRtcReady, setRtcReady] = createSignal(false);
  const [isCleanupDone, setCleanupDone] = createSignal(false);

  const [roomId, setRoomId] = createSignal<string | null>(null);
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
    roomId,
    setRoomCreated,
    setRtcReady,
    setCleanupDone,
    setSas,
    setAuthId,
    setPakeKey,
    setRoomId,
  };
}
