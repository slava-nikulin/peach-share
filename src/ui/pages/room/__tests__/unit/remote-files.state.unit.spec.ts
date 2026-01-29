import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileBus } from '../../../../lib/file-bus';
import type { FileTransfer } from '../../components/room-files/file-transfer';
import { type FileMeta, RemoteFilesState } from '../../components/room-files/state';

type TransferListener = Parameters<FileTransfer['onFile']>[0];
type TransferEvent = Parameters<TransferListener>[0];

class BusStub implements FileBus {
  public readonly sent: unknown[] = [];

  sendJSON(message: unknown): void {
    this.sent.push(message);
  }
  sendBinary(): void {}
  onJSON(): () => void {
    return (): void => {};
  }
  onBinary(): () => void {
    return (): void => {};
  }
  close(): void {}
}

class TransferStub {
  private readonly listeners = new Set<TransferListener>();

  public onFile(listener: TransferListener): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  public emit(event: TransferEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  public listenerCount(): number {
    return this.listeners.size;
  }
}

const meta = (overrides: Partial<FileMeta>): FileMeta => ({
  id: 'f1',
  name: 'file.bin',
  size: 10,
  addedAt: Date.now(),
  ...overrides,
});

describe('RemoteFilesState', () => {
  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('tracks announced files and updates on transfer completion', () => {
    const bus = new BusStub();
    const transfer = new TransferStub();
    const state = new RemoteFilesState(bus, transfer as unknown as FileTransfer);

    state.handleAnnounce(meta({ id: 'a' }));
    expect(state.files()).toHaveLength(1);

    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'application/octet-stream' });
    transfer.emit({ status: 'complete', meta: meta({ id: 'a' }), blob });

    const record = state.files()[0];
    expect(record.url).toBe('blob:mock');
    expect(record.downloading).toBe(false);
  });

  it('requests files and marks them as downloading', () => {
    const bus = new BusStub();
    const transfer = new TransferStub();
    const state = new RemoteFilesState(bus, transfer as unknown as FileTransfer);
    state.handleAnnounce(meta({ id: 'req' }));

    state.requestFile('req');

    const message = bus.sent.pop() as { type: string; id: string };
    expect(message).toMatchObject({ type: 'request', id: 'req' });
    expect(state.files()[0].downloading).toBe(true);
  });

  it('cleanup revokes urls, clears files, and unsubscribes transfer listener', () => {
    const bus = new BusStub();
    const transfer = new TransferStub();
    const state = new RemoteFilesState(bus, transfer as unknown as FileTransfer);
    state.handleAnnounce(meta({ id: 'c1' }));
    const blob = new Blob([new Uint8Array([9])]);
    transfer.emit({ status: 'complete', meta: meta({ id: 'c1' }), blob });
    state.cleanup();
    expect(state.files()).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    expect(transfer.listenerCount()).toBe(0);
  });
});
