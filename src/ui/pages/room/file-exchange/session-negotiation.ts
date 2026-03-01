import {
  HASH_MODE_SHA256_END,
  type HashMode,
  type HelloCapabilities,
  type HelloMsg,
  PROTOCOL_ID,
  type Protocol,
} from './protocol';
import { DATA_WIRE_HEADER_BYTES } from './wire';

export interface NegotiationConfig {
  transportMaxMessageBytes: number;
  fileChunkBytes: number;
  maxFileBytes: number;
}

export interface NegotiatedSessionSettings {
  protocol: Protocol;
  maxMessageBytes: number;
  chunkBytes: number;
  maxFileBytes: number;
  hashMode: HashMode;
  inventoryVersioning: true;
  inventoryPaging: true;
}

export type NegotiationState =
  | {
      status: 'pending';
      settings: NegotiatedSessionSettings;
    }
  | {
      status: 'established';
      settings: NegotiatedSessionSettings;
      peerSessionId: string;
      peerBuildId: string;
    }
  | {
      status: 'failed';
      settings: NegotiatedSessionSettings;
      reason: string;
      code: 'NEGOTIATION_FAILED' | 'BUILD_MISMATCH';
    };

export type NegotiationResult =
  | {
      ok: true;
      settings: NegotiatedSessionSettings;
    }
  | {
      ok: false;
      reason: string;
      code: 'NEGOTIATION_FAILED' | 'BUILD_MISMATCH';
    };

export function createDefaultNegotiatedSessionSettings(
  cfg: NegotiationConfig,
): NegotiatedSessionSettings {
  return {
    protocol: PROTOCOL_ID,
    maxMessageBytes: cfg.transportMaxMessageBytes,
    chunkBytes: cfg.fileChunkBytes,
    maxFileBytes: cfg.maxFileBytes,
    hashMode: HASH_MODE_SHA256_END,
    inventoryVersioning: true,
    inventoryPaging: true,
  };
}

export function buildLocalHelloCapabilities(cfg: NegotiationConfig): HelloCapabilities {
  return {
    maxMessageBytes: cfg.transportMaxMessageBytes,
    chunkBytes: cfg.fileChunkBytes,
    maxFileBytes: cfg.maxFileBytes,
    hash: {
      algorithms: ['sha256'],
      modes: [HASH_MODE_SHA256_END],
    },
    inventory: {
      versioning: true,
      paging: true,
    },
  };
}

export function buildLocalHelloMessage(
  sessionId: string,
  appBuildId: string,
  caps: HelloCapabilities,
): HelloMsg {
  return {
    p: PROTOCOL_ID,
    t: 'HELLO',
    sessionId,
    appBuildId,
    caps,
  };
}

export function negotiateSessionFromHello(
  localCaps: HelloCapabilities,
  localBuildId: string,
  msg: HelloMsg,
): NegotiationResult {
  if (msg.appBuildId !== localBuildId) {
    return {
      ok: false,
      code: 'BUILD_MISMATCH',
      reason: `Build mismatch detected (local=${localBuildId}, peer=${msg.appBuildId}). Please refresh/update.`,
    };
  }

  const peerCaps = msg.caps;
  if (!peerCaps) {
    return {
      ok: false,
      code: 'NEGOTIATION_FAILED',
      reason: 'peer HELLO is missing capability payload',
    };
  }

  const maxMessageBytes = Math.min(localCaps.maxMessageBytes, peerCaps.maxMessageBytes);
  if (maxMessageBytes <= DATA_WIRE_HEADER_BYTES) {
    return {
      ok: false,
      code: 'NEGOTIATION_FAILED',
      reason: `negotiated maxMessageBytes too small for DATA header (${maxMessageBytes})`,
    };
  }

  const maxChunkFromMessage = maxMessageBytes - DATA_WIRE_HEADER_BYTES;
  const chunkBytes = Math.min(localCaps.chunkBytes, peerCaps.chunkBytes, maxChunkFromMessage);
  if (chunkBytes <= 0) {
    return {
      ok: false,
      code: 'NEGOTIATION_FAILED',
      reason: 'failed to negotiate a positive chunk size',
    };
  }

  const maxFileBytes = Math.min(localCaps.maxFileBytes, peerCaps.maxFileBytes);
  if (maxFileBytes <= 0) {
    return {
      ok: false,
      code: 'NEGOTIATION_FAILED',
      reason: 'failed to negotiate a positive maxFileBytes',
    };
  }

  if (!peerCaps.hash.modes.includes(HASH_MODE_SHA256_END)) {
    return {
      ok: false,
      code: 'NEGOTIATION_FAILED',
      reason: 'peer does not support required hash mode sha256-end',
    };
  }

  if (!peerCaps.inventory.versioning || !peerCaps.inventory.paging) {
    return {
      ok: false,
      code: 'NEGOTIATION_FAILED',
      reason: 'peer does not support required inventory versioning/paging',
    };
  }

  return {
    ok: true,
    settings: {
      protocol: PROTOCOL_ID,
      maxMessageBytes,
      chunkBytes,
      maxFileBytes,
      hashMode: HASH_MODE_SHA256_END,
      inventoryVersioning: true,
      inventoryPaging: true,
    },
  };
}

export function isSameNegotiatedSessionSettings(
  left: NegotiatedSessionSettings,
  right: NegotiatedSessionSettings,
): boolean {
  return (
    left.protocol === right.protocol &&
    left.maxMessageBytes === right.maxMessageBytes &&
    left.chunkBytes === right.chunkBytes &&
    left.maxFileBytes === right.maxFileBytes &&
    left.hashMode === right.hashMode &&
    left.inventoryVersioning === right.inventoryVersioning &&
    left.inventoryPaging === right.inventoryPaging
  );
}
