import type { Database, DataSnapshot, Unsubscribe } from 'firebase/database';
import { get, onValue, ref, runTransaction, set } from 'firebase/database';
import type { RoomRepositoryPort } from '../../bll/ports/room-repository';

export class RoomWaitTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoomWaitTimeoutError';
  }
}

export class RoomPayloadInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoomPayloadInvalidError';
  }
}

/**
 * В реальности встречаются разные формы кода ошибки:
 * - database/permission-denied (часто в SDK-обвязках)
 * - PERMISSION_DENIED / permission_denied (разные слои/версии)
 * - permission-denied (иногда без префикса)
 */
function isPermissionDenied(err: unknown): boolean {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? (err as { code?: unknown }).code
      : undefined;
  if (typeof code !== 'string') return false;
  return (
    code === 'PERMISSION_DENIED' ||
    code === 'permission_denied' ||
    code === 'permission-denied' ||
    code === 'database/permission-denied'
  );
}

const LIMITS = {
  PAKE: 64,
  RTC: 32768,
} as const;

// RTDB server timestamp placeholder
const SV_TIMESTAMP = { '.sv': 'timestamp' } as const;

type Who = 'creator' | 'responder';
type SlotKind = 'create' | 'join';
type PakeField = 'msg' | 'mac_tag';

const PATH = {
  meta: (roomId: string) => `rooms/${roomId}/meta`,
  metaState: (roomId: string) => `rooms/${roomId}/meta/state`,
  metaDeleteRequested: (roomId: string) => `rooms/${roomId}/meta/deleteRequested`,
  messagesRoot: (roomId: string) => `rooms/${roomId}/messages`,

  slot: (uid: string, kind: SlotKind) => `${uid}/${kind}`,

  pake: (roomId: string, who: Who, field: PakeField) =>
    `rooms/${roomId}/messages/${who}/pake/${field}`,

  rtc: (roomId: string, who: Who) => `rooms/${roomId}/messages/${who}/rtc/msg`,
} as const;

function assertNonEmptyString(v: unknown, what: string, maxLen: number): string {
  if (typeof v !== 'string') throw new RoomPayloadInvalidError(`${what} must be a string`);
  if (v.length === 0) throw new RoomPayloadInvalidError(`${what} must be non-empty`);
  if (v.length > maxLen) throw new RoomPayloadInvalidError(`${what} exceeds max length ${maxLen}`);
  return v;
}

function waitForValueAtPath<T>(
  db: Database,
  path: string,
  timeoutMs: number,
  what: string,
  parse: (snap: DataSnapshot) => T | undefined, // undefined => "ещё не готово"
): Promise<T> {
  const r = ref(db, path);

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let unsub: Unsubscribe | undefined;

    const cleanup = () => {
      if (!unsub) return;
      try {
        unsub();
      } catch {
        // ignore
      }
    };

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      fn();
    };

    const timer = setTimeout(() => {
      finish(() =>
        reject(new RoomWaitTimeoutError(`Timed out waiting for ${what} after ${timeoutMs}ms`)),
      );
    }, timeoutMs);

    unsub = onValue(
      r,
      (snap) => {
        if (settled) return;
        try {
          const v = parse(snap);
          if (v !== undefined) finish(() => resolve(v));
        } catch (e) {
          finish(() => reject(e));
        }
      },
      (err) => finish(() => reject(err)),
    );
  });
}

function waitForStringAtPath(
  db: Database,
  path: string,
  timeoutMs: number,
  what: string,
  maxLen: number,
): Promise<string> {
  return waitForValueAtPath(db, path, timeoutMs, what, (snap) => {
    if (!snap.exists()) return undefined;
    return assertNonEmptyString(snap.val(), what, maxLen);
  });
}

export class RtdbRoomRepository implements RoomRepositoryPort {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  private r(path: string): ReturnType<typeof ref> {
    return ref(this.db, path);
  }

  private async readRoomMeta(
    roomId: string,
  ): Promise<{ state: number | undefined; deleteRequested: boolean }> {
    const snap = await get(this.r(PATH.meta(roomId)));
    if (!snap.exists()) return { state: undefined, deleteRequested: false };

    const value = snap.val();
    if (typeof value !== 'object' || value === null) {
      return { state: undefined, deleteRequested: false };
    }

    const meta = value as Record<string, unknown>;
    const stateRaw = meta.state;
    const state = typeof stateRaw === 'number' && Number.isFinite(stateRaw) ? stateRaw : undefined;
    const deleteRequested = meta.deleteRequested === true;

    return { state, deleteRequested };
  }

  private async probeReadable(path: string): Promise<void> {
    // Важно именно отсутствие PERMISSION_DENIED, существование узла не важно
    await get(this.r(path));
  }

  private async readMetaState(roomId: string): Promise<number | undefined> {
    const { state } = await this.readRoomMeta(roomId);
    return state;
  }

  private waitMetaStateAtLeast(roomId: string, min: number, timeoutMs: number): Promise<number> {
    return waitForValueAtPath<number>(
      this.db,
      PATH.metaState(roomId),
      timeoutMs,
      `room "${roomId}" meta/state >= ${min}`,
      (snap) => {
        if (!snap.exists()) return undefined;
        const v = Number(snap.val());
        if (!Number.isFinite(v)) throw new RoomPayloadInvalidError('meta/state must be a number');
        return v >= min ? v : undefined;
      },
    );
  }

  private async triggerSlot(uid: string, kind: SlotKind, roomId: string): Promise<void> {
    const createdAt = process.env.VITEST ? Date.now() : SV_TIMESTAMP;
    await set(this.r(PATH.slot(uid, kind)), {
      room_id: roomId,
      created_at: createdAt,
    });
  }

  private async enterRoom(
    uid: string,
    roomId: string,
    kind: SlotKind,
    minState: number,
    timeoutMs: number,
  ): Promise<void> {
    // fast-path: если state уже достаточный, просто проверим доступ к messages
    const s = await this.readMetaState(roomId);
    if (s !== undefined && s >= minState) {
      await this.probeReadable(PATH.messagesRoot(roomId));
      return;
    }

    // trigger
    await this.triggerSlot(uid, kind, roomId);

    // wait state
    await this.waitMetaStateAtLeast(roomId, minState, timeoutMs);

    // probe read messages: если PERMISSION_DENIED -> это "не твоя" комната
    await this.probeReadable(PATH.messagesRoot(roomId));
  }

  private async writeBoundedString(
    path: string,
    what: string,
    value: string,
    maxLen: number,
  ): Promise<void> {
    assertNonEmptyString(value, what, maxLen);
    await set(this.r(path), value);
  }

  private waitBoundedString(
    path: string,
    what: string,
    maxLen: number,
    timeoutMs: number,
  ): Promise<string> {
    return waitForStringAtPath(this.db, path, timeoutMs, what, maxLen);
  }

  private pakeLabel(roomId: string, who: Who, field: PakeField): string {
    return `room=${roomId} ${who}/pake/${field}`;
  }

  private rtcLabel(roomId: string, who: Who): string {
    return `room=${roomId} ${who}/rtc/msg`;
  }

  private writePake(
    roomId: string,
    who: Who,
    field: PakeField,
    payloadB64u: string,
  ): Promise<void> {
    return this.writeBoundedString(
      PATH.pake(roomId, who, field),
      this.pakeLabel(roomId, who, field),
      payloadB64u,
      LIMITS.PAKE,
    );
  }

  private waitPake(roomId: string, who: Who, field: PakeField, timeoutMs: number): Promise<string> {
    return this.waitBoundedString(
      PATH.pake(roomId, who, field),
      this.pakeLabel(roomId, who, field),
      LIMITS.PAKE,
      timeoutMs,
    );
  }

  private writeRtc(roomId: string, who: Who, boxed: string): Promise<void> {
    return this.writeBoundedString(
      PATH.rtc(roomId, who),
      this.rtcLabel(roomId, who),
      boxed,
      LIMITS.RTC,
    );
  }

  private waitRtc(roomId: string, who: Who, timeoutMs: number): Promise<string> {
    return this.waitBoundedString(
      PATH.rtc(roomId, who),
      this.rtcLabel(roomId, who),
      LIMITS.RTC,
      timeoutMs,
    );
  }

  // ---- RoomRepositoryPort ----

  async isRoomJoinable(roomId: string): Promise<boolean> {
    const meta = await this.readRoomMeta(roomId);
    if (meta.deleteRequested) return false;

    // Явно отражаем доменную модель joinable-state.
    return meta.state === 1 || meta.state === 2;
  }

  async roomJoin(uid: string, roomId: string, timeoutMs: number): Promise<void> {
    await this.enterRoom(uid, roomId, 'join', 2, timeoutMs);
  }

  async roomCreate(uid: string, roomId: string, timeoutMs: number): Promise<void> {
    await this.enterRoom(uid, roomId, 'create', 1, timeoutMs);
  }

  async finalize(roomId: string): Promise<void> {
    const meta = await this.readRoomMeta(roomId);
    if (meta.deleteRequested) return;

    // best-effort: может быть PERMISSION_DENIED, если правила запрещают
    try {
      await runTransaction(
        this.r(PATH.metaDeleteRequested(roomId)),
        (current) => {
          if (current !== null) return;
          return true;
        },
        { applyLocally: false },
      );
    } catch (e) {
      if (!isPermissionDenied(e)) throw e;
    }
  }

  // --- PAKE ---

  async writeA(roomId: string, payloadB64u: string): Promise<void> {
    await this.writePake(roomId, 'creator', 'msg', payloadB64u);
  }

  async writeB(roomId: string, payloadB64u: string): Promise<void> {
    await this.writePake(roomId, 'responder', 'msg', payloadB64u);
  }

  async waitA(roomId: string, timeoutMs: number): Promise<string> {
    return await this.waitPake(roomId, 'creator', 'msg', timeoutMs);
  }

  async waitB(roomId: string, timeoutMs: number): Promise<string> {
    return await this.waitPake(roomId, 'responder', 'msg', timeoutMs);
  }

  async writeKcA(roomId: string, tagB64u: string): Promise<void> {
    await this.writePake(roomId, 'creator', 'mac_tag', tagB64u);
  }

  async writeKcB(roomId: string, tagB64u: string): Promise<void> {
    await this.writePake(roomId, 'responder', 'mac_tag', tagB64u);
  }

  async waitKcA(roomId: string, timeoutMs: number): Promise<string> {
    return await this.waitPake(roomId, 'creator', 'mac_tag', timeoutMs);
  }

  async waitKcB(roomId: string, timeoutMs: number): Promise<string> {
    return await this.waitPake(roomId, 'responder', 'mac_tag', timeoutMs);
  }

  // --- WebRTC signaling (encrypted string) ---

  async writeOffer(roomId: string, boxedOffer: string): Promise<void> {
    await this.writeRtc(roomId, 'creator', boxedOffer);
  }

  async waitOffer(roomId: string, timeoutMs: number): Promise<string> {
    return await this.waitRtc(roomId, 'creator', timeoutMs);
  }

  async writeAnswer(roomId: string, boxedAnswer: string): Promise<void> {
    await this.writeRtc(roomId, 'responder', boxedAnswer);
  }

  async waitAnswer(roomId: string, timeoutMs: number): Promise<string> {
    return await this.waitRtc(roomId, 'responder', timeoutMs);
  }
}
