import { describe, expect, it } from 'vitest';
import type { P2pChannel } from '../../../../bll/ports/p2p-channel';
import { MessageTransport } from './message-transport';

function createLinkedChannels(): { a: P2pChannel; b: P2pChannel } {
  const aToB = new TransformStream<Uint8Array, Uint8Array>();
  const bToA = new TransformStream<Uint8Array, Uint8Array>();

  let closed = false;
  const aSubs = new Set<() => void>();
  const bSubs = new Set<() => void>();

  const fireClosed = (): void => {
    if (closed) return;
    closed = true;

    for (const cb of aSubs) {
      try {
        cb();
      } catch {}
    }

    for (const cb of bSubs) {
      try {
        cb();
      } catch {}
    }

    aSubs.clear();
    bSubs.clear();
  };

  const mkOnClose =
    (subs: Set<() => void>) =>
    (cb: () => void): (() => void) => {
      if (closed) {
        queueMicrotask(cb);
        return () => {};
      }

      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    };

  const a: P2pChannel = {
    readable: bToA.readable,
    writable: aToB.writable,
    close: fireClosed,
    onClose: mkOnClose(aSubs),
  };

  const b: P2pChannel = {
    readable: aToB.readable,
    writable: bToA.writable,
    close: fireClosed,
    onClose: mkOnClose(bSubs),
  };

  return { a, b };
}

async function waitFor(
  condition: () => boolean,
  opts: { timeoutMs?: number; stepMs?: number } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 2_000;
  const stepMs = opts.stepMs ?? 5;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, stepMs);
    });
  }

  throw new Error('waitFor timeout');
}

describe('MessageTransport', () => {
  it('uses bounded fairness between control and data queues', async () => {
    const { a, b } = createLinkedChannels();

    const sender = new MessageTransport(a, {
      maxConsecutiveControlJobs: 2,
      maxFrameBytes: 512,
      maxMessageBytes: 64 * 1024,
    });
    const receiver = new MessageTransport(b, {
      maxFrameBytes: 512,
      maxMessageBytes: 64 * 1024,
    });

    const te = new TextEncoder();
    const td = new TextDecoder();
    const received: string[] = [];

    receiver.onMessage((msg) => {
      received.push(td.decode(msg));
    });

    const sends: Promise<void>[] = [];
    for (let i = 0; i < 6; i += 1) {
      sends.push(sender.sendMessage(te.encode(`c${i}`), { priority: 'control' }));
    }
    for (let i = 0; i < 3; i += 1) {
      sends.push(sender.sendMessage(te.encode(`d${i}`), { priority: 'data' }));
    }

    await Promise.all(sends);
    await waitFor(() => received.length === 9);

    expect(received).toEqual(['c0', 'c1', 'd0', 'c2', 'c3', 'd1', 'c4', 'c5', 'd2']);

    await sender.dispose();
    await receiver.dispose();
  });

  it('preserves message boundaries with mixed priorities and fragmented payloads', async () => {
    const { a, b } = createLinkedChannels();

    const sender = new MessageTransport(a, {
      maxConsecutiveControlJobs: 1,
      maxFrameBytes: 64,
      maxMessageBytes: 64 * 1024,
    });
    const receiver = new MessageTransport(b, {
      maxFrameBytes: 64,
      maxMessageBytes: 64 * 1024,
    });

    const te = new TextEncoder();
    const td = new TextDecoder();
    const received: Uint8Array[] = [];

    receiver.onMessage((msg) => {
      received.push(msg.slice());
    });

    const dataPayload = new Uint8Array(16 * 1024);
    for (let i = 0; i < dataPayload.length; i += 1) {
      dataPayload[i] = i % 251;
    }

    await Promise.all([
      sender.sendMessage(te.encode('control-a'), { priority: 'control' }),
      sender.sendMessage(dataPayload, { priority: 'data' }),
      sender.sendMessage(te.encode('control-b'), { priority: 'control' }),
    ]);

    await waitFor(() => received.length === 3);

    expect(td.decode(received[0] ?? new Uint8Array())).toBe('control-a');
    expect(received[1]).toEqual(dataPayload);
    expect(td.decode(received[2] ?? new Uint8Array())).toBe('control-b');

    await sender.dispose();
    await receiver.dispose();
  });
});
