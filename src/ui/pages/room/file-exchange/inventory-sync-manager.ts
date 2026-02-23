import { type ControlMsg, type ControlMsgWithoutProtocol } from './protocol';
import type { FileDesc, SessionErrorCode, SessionState } from './types';

type TimeoutHandle = ReturnType<typeof setTimeout>;

type PendingInventoryDelta = {
  addById: Map<string, FileDesc>;
  removeIds: Set<string>;
};

type InventorySnapshotAssembly = {
  snapshotId: string;
  inventoryVersion: number;
  totalParts: number;
  parts: Array<readonly FileDesc[] | undefined>;
};

type InventoryControlType =
  | 'INVENTORY_SNAPSHOT'
  | 'INVENTORY_DELTA'
  | 'INVENTORY_RESYNC_REQUEST'
  | 'INVENTORY_SNAPSHOT_BEGIN'
  | 'INVENTORY_SNAPSHOT_PART'
  | 'INVENTORY_SNAPSHOT_END';

type InventoryControlMsgWithoutProtocol = Extract<ControlMsgWithoutProtocol, { t: InventoryControlType }>;
type InventoryControlMsg = Extract<ControlMsg, { t: InventoryControlType }>;

type InventorySyncManagerDeps = {
  getState: () => SessionState;
  getLocalFiles: () => readonly FileDesc[];
  getPeerFiles: () => readonly FileDesc[];
  setPeerFiles: (files: readonly FileDesc[]) => void;
  sendControl: (msg: InventoryControlMsgWithoutProtocol) => Promise<void>;
  canSendControlMessage: (msg: InventoryControlMsgWithoutProtocol) => boolean;
  emitSessionError: (code: SessionErrorCode, message: string, cause?: unknown) => void;
  onPeerSnapshotReceived: () => void;
  createId: () => string;
};

type InventorySyncManagerOpts = {
  deltaDebounceMs?: number;
  maxSnapshotParts?: number;
};

const DEFAULT_DELTA_DEBOUNCE_MS = 24;
const DEFAULT_MAX_SNAPSHOT_PARTS = 100_000;

export class InventorySyncManager {
  private readonly deps: InventorySyncManagerDeps;
  private readonly deltaDebounceMs: number;
  private readonly maxSnapshotParts: number;

  private localInventoryVersion = 0;
  private peerInventoryVersion: number | null = null;
  private pendingInventoryDelta: PendingInventoryDelta = { addById: new Map(), removeIds: new Set() };
  private inventoryDeltaFlushTimer?: TimeoutHandle;
  private inventoryDeltaFlushScheduled: Promise<void> | null = null;
  private inventoryDeltaFlushSettlers?: {
    resolve: () => void;
    reject: (error: unknown) => void;
  };
  private peerInventoryResyncRequested = false;
  private pendingPeerSnapshot?: InventorySnapshotAssembly;
  private peerSnapshotReceived = false;

  constructor(
    deps: InventorySyncManagerDeps,
    opts: InventorySyncManagerOpts = {},
  ) {
    this.deps = deps;
    this.deltaDebounceMs = opts.deltaDebounceMs ?? DEFAULT_DELTA_DEBOUNCE_MS;
    this.maxSnapshotParts = opts.maxSnapshotParts ?? DEFAULT_MAX_SNAPSHOT_PARTS;
  }

  hasPeerSnapshotReceived(): boolean {
    return this.peerSnapshotReceived;
  }

  enqueueLocalInventoryDelta(mutation: { add?: readonly FileDesc[]; remove?: readonly string[] }): void {
    for (const file of mutation.add ?? []) {
      this.pendingInventoryDelta.removeIds.delete(file.id);
      this.pendingInventoryDelta.addById.set(file.id, file);
    }

    for (const fileId of mutation.remove ?? []) {
      this.pendingInventoryDelta.addById.delete(fileId);
      this.pendingInventoryDelta.removeIds.add(fileId);
    }
  }

  async flushLocalInventoryDeltasSoon(): Promise<void> {
    if (this.deps.getState() === 'closed') {
      return;
    }

    if (this.inventoryDeltaFlushScheduled) {
      return this.inventoryDeltaFlushScheduled;
    }

    this.inventoryDeltaFlushScheduled = new Promise<void>((resolve, reject) => {
      this.inventoryDeltaFlushSettlers = { resolve, reject };
    });

    this.inventoryDeltaFlushTimer = setTimeout(() => {
      this.inventoryDeltaFlushTimer = undefined;
      void this.flushLocalInventoryDeltasNow()
        .then(() => {
          this.inventoryDeltaFlushSettlers?.resolve();
        })
        .catch((error) => {
          this.inventoryDeltaFlushSettlers?.reject(error);
          this.deps.emitSessionError('INVENTORY_SYNC_FAILED', 'Failed to flush pending inventory deltas', error);
        })
        .finally(() => {
          this.inventoryDeltaFlushScheduled = null;
          this.inventoryDeltaFlushSettlers = undefined;
        });
    }, this.deltaDebounceMs);

    return this.inventoryDeltaFlushScheduled;
  }

  async sendCurrentInventorySnapshot(): Promise<void> {
    if (this.deps.getState() === 'closed') {
      return;
    }

    await this.sendCurrentInventorySnapshotPaged();
  }

  handleControlMessage(msg: ControlMsg): boolean {
    switch (msg.t) {
      case 'INVENTORY_SNAPSHOT':
        this.handlePeerInventorySnapshot(msg);
        return true;

      case 'INVENTORY_SNAPSHOT_BEGIN':
        this.handlePeerInventorySnapshotBegin(msg);
        return true;

      case 'INVENTORY_SNAPSHOT_PART':
        this.handlePeerInventorySnapshotPart(msg);
        return true;

      case 'INVENTORY_SNAPSHOT_END':
        this.handlePeerInventorySnapshotEnd(msg);
        return true;

      case 'INVENTORY_DELTA':
        this.handlePeerInventoryDelta(msg);
        return true;

      case 'INVENTORY_RESYNC_REQUEST':
        void this.sendCurrentInventorySnapshot().catch((error) => {
          this.deps.emitSessionError(
            'INVENTORY_SYNC_FAILED',
            'Failed to respond to inventory resync request',
            error,
          );
        });
        return true;

      default:
        return false;
    }
  }

  dispose(error?: unknown): void {
    this.localInventoryVersion = 0;
    this.peerInventoryVersion = null;
    this.peerInventoryResyncRequested = false;
    this.pendingPeerSnapshot = undefined;
    this.pendingInventoryDelta = { addById: new Map(), removeIds: new Set() };
    this.peerSnapshotReceived = false;
    this.clearInventoryDeltaFlushState(error);
  }

  private handlePeerInventorySnapshot(msg: Extract<InventoryControlMsg, { t: 'INVENTORY_SNAPSHOT' }>): void {
    this.pendingPeerSnapshot = undefined;

    if (!isFiniteNonNegativeInteger(msg.inventoryVersion)) {
      this.requestPeerInventoryResync('snapshot_missing_inventory_version');
      return;
    }

    this.applyPeerSnapshot(msg.files, msg.inventoryVersion);
  }

  private handlePeerInventorySnapshotBegin(
    msg: Extract<InventoryControlMsg, { t: 'INVENTORY_SNAPSHOT_BEGIN' }>,
  ): void {
    if (msg.totalParts > this.maxSnapshotParts) {
      this.requestPeerInventoryResync('snapshot_total_parts_exceeds_limit');
      return;
    }

    this.pendingPeerSnapshot = {
      snapshotId: msg.snapshotId,
      inventoryVersion: msg.inventoryVersion,
      totalParts: msg.totalParts,
      parts: new Array(msg.totalParts),
    };
  }

  private handlePeerInventorySnapshotPart(
    msg: Extract<InventoryControlMsg, { t: 'INVENTORY_SNAPSHOT_PART' }>,
  ): void {
    const pending = this.pendingPeerSnapshot;
    if (!pending) {
      this.requestPeerInventoryResync('snapshot_part_without_begin');
      return;
    }

    if (msg.snapshotId !== pending.snapshotId) {
      this.requestPeerInventoryResync('snapshot_part_id_mismatch');
      return;
    }

    if (msg.partIndex < 0 || msg.partIndex >= pending.totalParts) {
      this.requestPeerInventoryResync('snapshot_part_index_out_of_range');
      return;
    }

    pending.parts[msg.partIndex] = msg.files.slice();
  }

  private handlePeerInventorySnapshotEnd(msg: Extract<InventoryControlMsg, { t: 'INVENTORY_SNAPSHOT_END' }>): void {
    const pending = this.pendingPeerSnapshot;
    if (!pending) {
      this.requestPeerInventoryResync('snapshot_end_without_begin');
      return;
    }

    if (msg.snapshotId !== pending.snapshotId) {
      this.requestPeerInventoryResync('snapshot_end_id_mismatch');
      return;
    }

    if (msg.totalParts !== pending.totalParts) {
      this.requestPeerInventoryResync('snapshot_end_total_parts_mismatch');
      return;
    }

    if (msg.inventoryVersion !== pending.inventoryVersion) {
      this.requestPeerInventoryResync('snapshot_end_version_mismatch');
      return;
    }

    if (!isFiniteNonNegativeInteger(msg.inventoryVersion)) {
      this.requestPeerInventoryResync('snapshot_end_invalid_version');
      return;
    }

    const files: FileDesc[] = [];
    for (let i = 0; i < pending.totalParts; i += 1) {
      const part = pending.parts[i];
      if (!part) {
        this.requestPeerInventoryResync('snapshot_missing_parts');
        return;
      }

      files.push(...part);
    }

    this.pendingPeerSnapshot = undefined;
    this.applyPeerSnapshot(files, msg.inventoryVersion);
  }

  private handlePeerInventoryDelta(msg: Extract<InventoryControlMsg, { t: 'INVENTORY_DELTA' }>): void {
    const add = msg.add;
    const remove = msg.remove;

    if (!isFiniteNonNegativeInteger(msg.baseVersion) || !isFiniteNonNegativeInteger(msg.nextVersion)) {
      this.requestPeerInventoryResync('delta_missing_versions');
      return;
    }

    if (msg.nextVersion !== msg.baseVersion + 1) {
      this.requestPeerInventoryResync('delta_version_step_invalid');
      return;
    }

    if (this.peerInventoryVersion == null) {
      this.requestPeerInventoryResync('delta_received_before_snapshot');
      return;
    }

    if (msg.baseVersion !== this.peerInventoryVersion) {
      this.requestPeerInventoryResync('delta_base_version_mismatch');
      return;
    }

    this.deps.setPeerFiles(applyInventoryDelta(this.deps.getPeerFiles(), add, remove));
    this.peerInventoryVersion = msg.nextVersion;
  }

  private applyPeerSnapshot(files: readonly FileDesc[], inventoryVersion: number): void {
    this.peerSnapshotReceived = true;
    this.peerInventoryResyncRequested = false;
    this.pendingPeerSnapshot = undefined;
    this.peerInventoryVersion = inventoryVersion;

    this.deps.setPeerFiles(files.slice());
    this.deps.onPeerSnapshotReceived();
  }

  private requestPeerInventoryResync(reason: string): void {
    this.pendingPeerSnapshot = undefined;

    if (this.peerInventoryResyncRequested || this.deps.getState() === 'closed') {
      return;
    }

    this.peerInventoryResyncRequested = true;

    void this.deps.sendControl({
      t: 'INVENTORY_RESYNC_REQUEST',
      reason,
    }).catch((error) => {
      this.peerInventoryResyncRequested = false;
      this.deps.emitSessionError('INVENTORY_SYNC_FAILED', 'Failed to request inventory resync', error);
    });
  }

  private async flushLocalInventoryDeltasNow(): Promise<void> {
    if (this.deps.getState() === 'closed') return;

    if (this.inventoryDeltaFlushTimer) {
      clearTimeout(this.inventoryDeltaFlushTimer);
      this.inventoryDeltaFlushTimer = undefined;
    }

    const add = Array.from(this.pendingInventoryDelta.addById.values());
    const remove = Array.from(this.pendingInventoryDelta.removeIds.values());
    if (add.length === 0 && remove.length === 0) {
      return;
    }

    this.pendingInventoryDelta = { addById: new Map(), removeIds: new Set() };

    try {
      await this.sendInventoryDeltaBatches(add, remove);
    } catch (error) {
      this.enqueueLocalInventoryDelta({ add, remove });
      this.peerSnapshotReceived = false;
      this.peerInventoryResyncRequested = false;
      void this.sendCurrentInventorySnapshot().catch((snapshotError) => {
        this.deps.emitSessionError(
          'INVENTORY_SYNC_FAILED',
          'Failed to heal inventory state after delta send failure',
          snapshotError,
        );
      });
      throw error;
    }
  }

  private async sendInventoryDeltaBatches(add: readonly FileDesc[], remove: readonly string[]): Promise<void> {
    let addOffset = 0;
    let removeOffset = 0;

    while (addOffset < add.length || removeOffset < remove.length) {
      const baseVersion = this.localInventoryVersion;
      const chunk = this.takeNextInventoryDeltaChunk(add.slice(addOffset), remove.slice(removeOffset), baseVersion);

      await this.deps.sendControl(chunk.message);

      addOffset += chunk.addConsumed;
      removeOffset += chunk.removeConsumed;
      this.localInventoryVersion = baseVersion + 1;
    }
  }

  private takeNextInventoryDeltaChunk(
    add: readonly FileDesc[],
    remove: readonly string[],
    baseVersion: number,
  ): {
    message: Extract<InventoryControlMsgWithoutProtocol, { t: 'INVENTORY_DELTA' }>;
    addConsumed: number;
    removeConsumed: number;
  } {
    const chunkAdd: FileDesc[] = [];
    const chunkRemove: string[] = [];
    let addConsumed = 0;
    let removeConsumed = 0;

    const buildMessage = (): Extract<InventoryControlMsgWithoutProtocol, { t: 'INVENTORY_DELTA' }> => {
      return {
        t: 'INVENTORY_DELTA',
        add: chunkAdd.length > 0 ? chunkAdd : undefined,
        remove: chunkRemove.length > 0 ? chunkRemove : undefined,
        baseVersion,
        nextVersion: baseVersion + 1,
      };
    };

    let progressed = true;
    while (progressed) {
      progressed = false;

      if (addConsumed < add.length) {
        const candidate = add[addConsumed];
        if (candidate) {
          chunkAdd.push(candidate);
          if (this.deps.canSendControlMessage(buildMessage())) {
            addConsumed += 1;
            progressed = true;
          } else {
            chunkAdd.pop();
          }
        }
      }

      if (removeConsumed < remove.length) {
        const candidate = remove[removeConsumed];
        if (candidate) {
          chunkRemove.push(candidate);
          if (this.deps.canSendControlMessage(buildMessage())) {
            removeConsumed += 1;
            progressed = true;
          } else {
            chunkRemove.pop();
          }
        }
      }
    }

    if (addConsumed === 0 && removeConsumed === 0) {
      if (add[0]) {
        throw new Error(`inventory delta add item too large to fit controlMaxBytes: ${add[0].id}`);
      }
      if (remove[0]) {
        throw new Error(`inventory delta remove item too large to fit controlMaxBytes: ${remove[0]}`);
      }
      throw new Error('inventory delta chunking failed unexpectedly');
    }

    return {
      message: buildMessage(),
      addConsumed,
      removeConsumed,
    };
  }

  private async sendCurrentInventorySnapshotPaged(): Promise<void> {
    const snapshotId = this.deps.createId();
    const inventoryVersion = this.localInventoryVersion;

    const parts = this.buildSnapshotParts(this.deps.getLocalFiles(), snapshotId);
    const totalParts = parts.length;

    await this.deps.sendControl({
      t: 'INVENTORY_SNAPSHOT_BEGIN',
      snapshotId,
      inventoryVersion,
      totalParts,
    });

    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      const files = parts[partIndex];
      if (!files) continue;

      await this.deps.sendControl({
        t: 'INVENTORY_SNAPSHOT_PART',
        snapshotId,
        partIndex,
        files,
      });
    }

    await this.deps.sendControl({
      t: 'INVENTORY_SNAPSHOT_END',
      snapshotId,
      inventoryVersion,
      totalParts,
    });
  }

  private buildSnapshotParts(files: readonly FileDesc[], snapshotId: string): FileDesc[][] {
    const parts: FileDesc[][] = [];
    let offset = 0;

    while (offset < files.length) {
      const partFiles: FileDesc[] = [];

      while (offset < files.length) {
        const candidate = files[offset];
        if (!candidate) break;

        partFiles.push(candidate);

        const testMessage: Extract<InventoryControlMsgWithoutProtocol, { t: 'INVENTORY_SNAPSHOT_PART' }> = {
          t: 'INVENTORY_SNAPSHOT_PART',
          snapshotId,
          partIndex: parts.length,
          files: partFiles,
        };

        if (this.deps.canSendControlMessage(testMessage)) {
          offset += 1;
          continue;
        }

        partFiles.pop();
        break;
      }

      if (partFiles.length === 0) {
        const fileId = files[offset]?.id ?? 'unknown';
        throw new Error(`inventory snapshot file entry too large to fit controlMaxBytes: ${fileId}`);
      }

      parts.push(partFiles);
      if (parts.length > this.maxSnapshotParts) {
        throw new Error(`inventory snapshot exceeds max parts limit (${this.maxSnapshotParts})`);
      }
    }

    if (parts.length === 0) {
      parts.push([]);
    }

    return parts;
  }

  private clearInventoryDeltaFlushState(error?: unknown): void {
    if (this.inventoryDeltaFlushTimer) {
      clearTimeout(this.inventoryDeltaFlushTimer);
      this.inventoryDeltaFlushTimer = undefined;
    }

    if (this.inventoryDeltaFlushSettlers) {
      if (error === undefined) {
        this.inventoryDeltaFlushSettlers.resolve();
      } else {
        this.inventoryDeltaFlushSettlers.reject(error);
      }
      this.inventoryDeltaFlushSettlers = undefined;
    }

    this.inventoryDeltaFlushScheduled = null;
  }
}

function applyInventoryDelta(
  current: readonly FileDesc[],
  add: readonly FileDesc[] | undefined,
  remove: readonly string[] | undefined,
): FileDesc[] {
  const removedIds = new Set(remove ?? []);
  const byId = new Map<string, FileDesc>();

  for (const file of current) {
    if (removedIds.has(file.id)) continue;
    byId.set(file.id, file);
  }

  for (const file of add ?? []) {
    byId.set(file.id, file);
  }

  return Array.from(byId.values());
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}
