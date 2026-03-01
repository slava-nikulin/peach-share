type RoomDiagDetails = Record<string, unknown>;

const DIAG_PREFIX = '[room-diag]';
const GLOBAL_FLAG = '__PEACH_ROOM_DIAG__';
const STORAGE_KEY = 'peach:room-diag';
const ENV_KEY = 'PEACH_ROOM_DIAG';

function isEnabledFromGlobalFlag(): boolean {
  try {
    return (globalThis as Record<string, unknown>)[GLOBAL_FLAG] === true;
  } catch {
    return false;
  }
}

function isEnabledFromStorage(): boolean {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    return storage?.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function isEnabledFromEnv(): boolean {
  try {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
    return proc?.env?.[ENV_KEY] === '1';
  } catch {
    return false;
  }
}

export function isRoomDiagEnabled(): boolean {
  return isEnabledFromGlobalFlag() || isEnabledFromStorage() || isEnabledFromEnv();
}

export function roomDiag(scope: string, message: string, details?: RoomDiagDetails): void {
  if (!isRoomDiagEnabled()) return;

  const now = new Date().toISOString();
  if (details) {
    console.info(DIAG_PREFIX, now, scope, message, details);
    return;
  }

  console.info(DIAG_PREFIX, now, scope, message);
}
