export function uuid(): string {
  return crypto.randomUUID();
}

/** Стабильный peerId на (браузер × roomId).
 *  Дубликат вкладки той же комнаты получит тот же peerId (ожидаемое поведение).
 *  Другая комната — другой peerId. Другой браузер — другой peerId. */
export function getOrCreatePeerId(roomId: string): string {
  const key = `peachshare:peer:${roomId}`;
  let v = localStorage.getItem(key);
  if (!v) { v = uuid(); localStorage.setItem(key, v); }
  return v;
}
