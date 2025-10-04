import { createSignal } from "solid-js"

export type Intent = 'create' | 'join'
export type RoomVM = ReturnType<typeof createRoomVM>

export function createRoomVM() {
  const [isRoomCreated, setRoomCreated] = createSignal(false)
  const [isRtcReady, setRtcReady] = createSignal(false)
  const [isCleanupDone, setCleanupDone] = createSignal(false)

  const [roomId, setRoomId] = createSignal<string | null>(null)
  const [authId, setAuthId] = createSignal<string | null>(null)
  const [pakeKey, setPakeKey] = createSignal<string | null>(null)
  const [sas, setSas] = createSignal<string | null>(null)

  return {
    isRoomCreated, isRtcReady, isCleanupDone, sas, authId, pakeKey, roomId,
    setRoomCreated, setRtcReady, setCleanupDone, setSas, setAuthId, setPakeKey, setRoomId
  }
}
