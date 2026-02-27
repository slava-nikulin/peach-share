import type { P2pChannel } from '../../../../bll/ports/p2p-channel';
import { fragmentMessage, Reassembler } from './transport-chunker';

export interface MessageTransportOpts {
  maxFrameBytes?: number;
  maxMessageBytes?: number;
  yieldEveryFrames?: number;
  maxQueuedWriteBytes?: number;
  maxConsecutiveControlJobs?: number;
  onTransportError?: (error: unknown) => void;
}

export type SendPriority = 'control' | 'data';

type Unsub = () => void;
type MsgHandler = (msg: Uint8Array) => void;

interface SendJob {
  message: Uint8Array;
  priority: SendPriority;
  resolve: () => void;
  reject: (error: unknown) => void;
}

export class MessageTransport {
  private readonly subs = new Set<MsgHandler>();

  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  private readonly onCloseUnsub: Unsub;

  private readonly reassembler: Reassembler;
  private readonly maxFrameBytes: number;
  private readonly maxMessageBytes: number;
  private readonly yieldEveryFrames: number;
  private readonly maxQueuedWriteBytes: number;
  private readonly maxConsecutiveControlJobs: number;
  private readonly onTransportError?: (error: unknown) => void;

  private readonly readLoopPromise: Promise<void>;

  private readonly controlQueue: SendJob[] = [];
  private readonly dataQueue: SendJob[] = [];
  private sendPumpPromise: Promise<void> | null = null;
  private consecutiveControlJobsSent = 0;

  private disposed = false;

  constructor(channel: P2pChannel, opts: MessageTransportOpts = {}) {
    this.maxFrameBytes = opts.maxFrameBytes ?? 16 * 1024;
    this.maxMessageBytes = opts.maxMessageBytes ?? 8 * 1024 * 1024;
    this.yieldEveryFrames = Math.max(1, opts.yieldEveryFrames ?? 8);
    this.maxQueuedWriteBytes = Math.max(16 * 1024, opts.maxQueuedWriteBytes ?? 512 * 1024);
    this.maxConsecutiveControlJobs = Math.max(1, opts.maxConsecutiveControlJobs ?? 8);
    this.onTransportError = opts.onTransportError;

    this.reassembler = new Reassembler({ maxMessageBytes: this.maxMessageBytes });

    if (channel.readable.locked) {
      throw new Error(
        'P2pChannel readable stream is already locked; dispose previous session first',
      );
    }
    if (channel.writable.locked) {
      throw new Error(
        'P2pChannel writable stream is already locked; dispose previous session first',
      );
    }

    this.reader = channel.readable.getReader();
    this.writer = channel.writable.getWriter();

    this.onCloseUnsub = channel.onClose(() => {
      void this.dispose();
    });

    this.readLoopPromise = this.runInboundLoop();
  }

  onMessage(cb: MsgHandler): Unsub {
    if (this.disposed) return noop;

    this.subs.add(cb);
    return (): void => {
      this.subs.delete(cb);
    };
  }

  sendMessage(message: Uint8Array, opts?: { priority?: SendPriority }): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new Error('MessageTransport disposed'));
    }

    if (message.length > this.maxMessageBytes) {
      return Promise.reject(
        new Error(
          `outbound message exceeds maxMessageBytes=${this.maxMessageBytes} (got ${message.length})`,
        ),
      );
    }

    return new Promise<void>((resolve, reject) => {
      const job: SendJob = {
        message,
        priority: opts?.priority ?? 'data',
        resolve,
        reject,
      };

      if (job.priority === 'control') {
        this.controlQueue.push(job);
      } else {
        this.dataQueue.push(job);
      }

      this.ensureSendPump();
    });
  }

  createSendSink(opts?: { onAfterWrite?: (msg: Uint8Array) => void }): WritableStream<Uint8Array> {
    return new WritableStream<Uint8Array>({
      write: async (msg: Uint8Array): Promise<void> => {
        await this.sendMessage(msg, { priority: 'data' });
        opts?.onAfterWrite?.(msg);
      },
      close: async (): Promise<void> => {
        // A single file pipeline finishing must not close the shared transport.
      },
      abort: async (): Promise<void> => {
        // No-op. Session owns full lifecycle.
      },
    });
  }

  /**
   * Stops loops and releases reader/writer locks.
   * Does not close the underlying channel.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    this.rejectPendingSends(new Error('MessageTransport disposed'));

    safeCall(this.onCloseUnsub);

    try {
      await this.reader.cancel();
    } catch {}

    try {
      await this.readLoopPromise;
    } catch {}

    try {
      await this.sendPumpPromise;
    } catch {}

    try {
      this.reader.releaseLock();
    } catch {}

    // No writer.close(): transport does not own channel close semantics.
    try {
      this.writer.releaseLock();
    } catch {}

    this.reassembler.reset();
    this.subs.clear();
  }

  private ensureSendPump(): void {
    if (this.sendPumpPromise || this.disposed) return;

    this.sendPumpPromise = this.runSendPump().finally(() => {
      this.sendPumpPromise = null;
      if (!this.disposed && this.hasPendingSendJobs()) {
        this.ensureSendPump();
      }
    });
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: todo refactor
  private async runSendPump(): Promise<void> {
    while (!this.disposed) {
      const job = this.shiftSendJob();
      if (!job) return;

      try {
        let frameCount = 0;
        let queuedWriteBytes = 0;
        const queuedWrites: Promise<void>[] = [];

        const flushQueuedWrites = async (): Promise<void> => {
          if (queuedWrites.length === 0) return;
          const pending = queuedWrites.splice(0);
          queuedWriteBytes = 0;
          await Promise.all(pending);
        };

        for (const frame of fragmentMessage(job.message, this.maxFrameBytes)) {
          if (this.disposed) throw new Error('MessageTransport disposed');

          queuedWrites.push(this.writer.write(frame));
          queuedWriteBytes += frame.length;

          frameCount += 1;
          if (queuedWriteBytes >= this.maxQueuedWriteBytes) {
            // biome-ignore lint/performance/noAwaitInLoops: todo refactor
            await flushQueuedWrites();
          }

          if (frameCount % this.yieldEveryFrames === 0) {
            await yieldToEventLoop();
          }
        }

        await flushQueuedWrites();
        job.resolve();
      } catch (error) {
        job.reject(error);
      }
    }
  }

  private shiftSendJob(): SendJob | undefined {
    const hasControl = this.controlQueue.length > 0;
    const hasData = this.dataQueue.length > 0;

    if (!hasControl && !hasData) {
      this.consecutiveControlJobsSent = 0;
      return undefined;
    }

    if (
      hasControl &&
      (!hasData || this.consecutiveControlJobsSent < this.maxConsecutiveControlJobs)
    ) {
      this.consecutiveControlJobsSent = Math.min(
        this.maxConsecutiveControlJobs,
        this.consecutiveControlJobsSent + 1,
      );
      return this.controlQueue.shift();
    }

    if (hasData) {
      this.consecutiveControlJobsSent = 0;
      return this.dataQueue.shift();
    }

    this.consecutiveControlJobsSent = 0;
    return undefined;
  }

  private hasPendingSendJobs(): boolean {
    return this.controlQueue.length > 0 || this.dataQueue.length > 0;
  }

  private rejectPendingSends(error: Error): void {
    const queues = [this.controlQueue, this.dataQueue];
    for (const queue of queues) {
      while (queue.length > 0) {
        const job = queue.shift();
        if (!job) break;
        job.reject(error);
      }
    }
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: todo refactor
  private async runInboundLoop(): Promise<void> {
    try {
      while (!this.disposed) {
        // biome-ignore lint/performance/noAwaitInLoops: todo refactor
        const { value, done } = await this.reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;

        let message: Uint8Array | null = null;

        try {
          message = this.reassembler.push(value);
        } catch (error) {
          this.reassembler.reset();
          this.reportTransportError(error);
          continue;
        }

        if (!message) continue;

        for (const cb of this.subs) {
          safeCall(() => cb(message));
        }
      }
    } catch (error) {
      if (!this.disposed) {
        this.reportTransportError(error);
      }
    } finally {
      this.reassembler.reset();
    }
  }

  private reportTransportError(error: unknown): void {
    safeCall(() => this.onTransportError?.(error));
  }
}

function yieldToEventLoop(): Promise<void> {
  // Use microtask yielding instead of timers to avoid background-tab timer throttling
  // from stalling outbound transfer pumps.
  return Promise.resolve();
}

function safeCall(fn: (() => void) | undefined): void {
  if (!fn) return;
  try {
    fn();
  } catch {
    // Ignore callback errors.
  }
}

function noop(): void {}
