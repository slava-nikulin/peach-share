import { DATA_WIRE_HEADER_BYTES } from './wire';

export interface FileExchangeConfig {
  controlMaxBytes?: number;
  fileChunkBytes?: number;
  inventoryResendIntervalMs?: number;
  appBuildId?: string;

  transportMaxFrameBytes?: number;
  transportMaxMessageBytes?: number;

  maxConcurrentOutgoingTransfers?: number;
  maxConcurrentIncomingTransfers?: number;

  maxFileBytes?: number;
  maxBufferedIncomingBytes?: number;

  metaTimeoutMs?: number;
  idleTimeoutMs?: number;
  /** `undefined` => default hard timeout, `null` => disabled, positive => enabled. */
  hardTimeoutMs?: number | null;

  closeOnProtocolViolation?: boolean;
}

export interface ResolvedConfig {
  controlMaxBytes: number;
  fileChunkBytes: number;
  inventoryResendIntervalMs: number;
  appBuildId: string;

  transportMaxFrameBytes: number;
  transportMaxMessageBytes: number;

  maxConcurrentOutgoingTransfers: number;
  maxConcurrentIncomingTransfers: number;

  maxFileBytes: number;
  maxBufferedIncomingBytes: number;

  metaTimeoutMs: number;
  idleTimeoutMs: number;
  hardTimeoutMs: number | null;

  closeOnProtocolViolation: boolean;
}

export function resolveConfig(config: FileExchangeConfig): ResolvedConfig {
  const hardTimeoutMs = resolveHardTimeoutMs(config.hardTimeoutMs);

  const resolved: ResolvedConfig = {
    controlMaxBytes: normalizePositiveInt(config.controlMaxBytes, 32 * 1024),
    fileChunkBytes: normalizePositiveInt(config.fileChunkBytes, 256 * 1024),
    inventoryResendIntervalMs: normalizePositiveInt(config.inventoryResendIntervalMs, 10_000),
    appBuildId: normalizeBuildId(config.appBuildId),

    transportMaxFrameBytes: normalizePositiveInt(config.transportMaxFrameBytes, 16 * 1024),
    transportMaxMessageBytes: normalizePositiveInt(
      config.transportMaxMessageBytes,
      8 * 1024 * 1024,
    ),

    maxConcurrentOutgoingTransfers: normalizePositiveInt(config.maxConcurrentOutgoingTransfers, 2),
    maxConcurrentIncomingTransfers: normalizePositiveInt(config.maxConcurrentIncomingTransfers, 2),

    maxFileBytes: normalizePositiveInt(config.maxFileBytes, 128 * 1024 * 1024),
    maxBufferedIncomingBytes: normalizePositiveInt(
      config.maxBufferedIncomingBytes,
      64 * 1024 * 1024,
    ),

    metaTimeoutMs: normalizePositiveInt(config.metaTimeoutMs, 15_000),
    idleTimeoutMs: normalizePositiveInt(config.idleTimeoutMs, 30_000),
    hardTimeoutMs,

    closeOnProtocolViolation: config.closeOnProtocolViolation === true,
  };

  validateTransportMessageSizeBounds(resolved);
  return resolved;
}

function resolveHardTimeoutMs(value: number | null | undefined): number | null {
  if (value === undefined) {
    return 2 * 60 * 60 * 1000;
  }

  return normalizeNullablePositiveInt(value);
}

function validateTransportMessageSizeBounds(cfg: ResolvedConfig): void {
  const minControlMessageBytes = 1 + cfg.controlMaxBytes;
  const minDataMessageBytes = DATA_WIRE_HEADER_BYTES + cfg.fileChunkBytes;
  const minRequired = Math.max(minControlMessageBytes, minDataMessageBytes);

  if (cfg.transportMaxMessageBytes >= minRequired) {
    return;
  }

  throw new Error(
    [
      'invalid FileExchangeSession config:',
      `transportMaxMessageBytes (${cfg.transportMaxMessageBytes}) must be >=`,
      `max(1 + controlMaxBytes (${minControlMessageBytes}),`,
      `DATA_WIRE_HEADER_BYTES + fileChunkBytes (${minDataMessageBytes})).`,
    ].join(' '),
  );
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

function normalizeNullablePositiveInt(value: number | null): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.floor(value);
}

function normalizeBuildId(value: string | undefined): string {
  if (typeof value !== 'string') {
    return 'dev-build';
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : 'dev-build';
}
