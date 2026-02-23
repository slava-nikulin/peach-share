import type { Instance as PeerInstance } from 'simple-peer';
import type { P2pChannel } from '../../bll/ports/p2p-channel';

type PeerWritableLike = {
  write(chunk: Uint8Array, cb?: (err?: unknown) => void): boolean | void;
  on(event: 'data', cb: (data: unknown) => void): void;
  on(event: 'error', cb: (err: unknown) => void): void;
  on(event: 'close', cb: () => void): void;

  removeListener(event: 'data', cb: (data: unknown) => void): void;
  removeListener(event: 'error', cb: (err: unknown) => void): void;
  removeListener(event: 'close', cb: () => void): void;

  destroy(err?: unknown): void;
};

function normalizeIncomingData(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new Error(`Unsupported incoming data type: ${Object.prototype.toString.call(data)}`);
}

function asPeerWritable(peer: PeerInstance): PeerWritableLike {
  return peer as unknown as PeerWritableLike;
}

export class SimplePeerChannel implements P2pChannel {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;

  private readonly peer: PeerWritableLike;

  private readonly closeSubs = new Set<() => void>();
  private closed = false;

  private rsCleanup?: () => void;

  constructor(peer: PeerInstance) {
    this.peer = asPeerWritable(peer);

    const onClosed = () => this.fireClosed();
    this.peer.on('close', onClosed);
    this.peer.on('error', onClosed);

    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        let ended = false;

        const safeClose = () => {
          if (ended) return;
          ended = true;
          try {
            controller.close();
          } catch {}
        };

        const safeError = (err: unknown) => {
          if (ended) return;
          ended = true;
          try {
            controller.error(err instanceof Error ? err : new Error(String(err)));
          } catch {}
        };

        const onData = (d: unknown) => {
          try {
            controller.enqueue(normalizeIncomingData(d));
          } catch (e) {
            safeError(e);
          }
        };

        const onClose = () => safeClose();
        const onError = (e: unknown) => safeError(e);

        this.peer.on('data', onData);
        this.peer.on('close', onClose);
        this.peer.on('error', onError);

        this.rsCleanup = () => {
          this.peer.removeListener('data', onData);
          this.peer.removeListener('close', onClose);
          this.peer.removeListener('error', onError);
        };
      },
      cancel: () => {
        try {
          this.rsCleanup?.();
        } catch {}
      },
    });

    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        if (this.closed) return Promise.reject(new Error('channel closed'));

        return new Promise<void>((resolve, reject) => {
          try {
            this.peer.write(chunk, (err?: unknown) => {
              if (err) reject(err instanceof Error ? err : new Error(String(err)));
              else resolve();
            });
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        });
      },
      close: async () => {
        // no-op: lifecycle управляется только channel.close()
      },
      abort: async () => {
        // no-op
      },
    });
  }

  close(): void {
    if (this.closed) return;
    try {
      this.peer.destroy();
    } finally {
      this.fireClosed();
    }
  }

  onClose(cb: () => void): () => void {
    if (this.closed) {
      queueMicrotask(cb);
      return () => {};
    }
    this.closeSubs.add(cb);
    return () => this.closeSubs.delete(cb);
  }

  private fireClosed(): void {
    if (this.closed) return;
    this.closed = true;

    try {
      this.rsCleanup?.();
    } catch {}
    this.rsCleanup = undefined;

    for (const cb of this.closeSubs) {
      try {
        cb();
      } catch {}
    }
    this.closeSubs.clear();
  }
}
