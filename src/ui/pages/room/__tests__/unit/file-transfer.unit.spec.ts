import { describe, expect, it, vi } from 'vitest';
import type { FileBus } from '../../../../lib/file-bus';
import type { RtcEndpoint } from '../../../../lib/webrtc';
import { FileTransfer, type FileTransferMeta } from '../../components/room-files/file-transfer';

class MockDataChannel extends EventTarget {
  public readonly label: string;
  public readonly ordered: boolean = true;
  public readonly protocol = '';
  public readonly negotiated = true;
  public readonly id = 0;
  public readonly maxRetransmits: number | null = null;
  public readonly maxPacketLifeTime: number | null = null;
  public binaryType: BinaryType = 'arraybuffer';
  public readyState: RTCDataChannelState = 'open';
  public bufferedAmount = 0;
  public bufferedAmountLowThreshold = 0;
  public readonly sent: ArrayBuffer[] = [];

  public constructor(label: string) {
    super();
    this.label = label;
  }

  public close(): void {
    this.readyState = 'closed';
    this.dispatchEvent(new Event('close'));
  }

  public send(data: string | ArrayBuffer | ArrayBufferView | Blob): void {
    if (typeof data === 'string') {
      throw new Error('string payload not supported in mock');
    }
    if (data instanceof Blob) {
      throw new Error('blob payload not supported in mock');
    }
    if (data instanceof ArrayBuffer) {
      this.sent.push(data);
      this.bufferedAmount += data.byteLength;
      return;
    }
    const sourceView = ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
      : new Uint8Array();
    const buffer = new ArrayBuffer(sourceView.byteLength);
    new Uint8Array(buffer).set(sourceView);
    this.sent.push(buffer);
    this.bufferedAmount += buffer.byteLength;
  }

  public drainAll(): void {
    this.bufferedAmount = 0;
    this.dispatchEvent(new Event('bufferedamountlow'));
  }

  public emitMessage(buffer: ArrayBuffer): void {
    this.dispatchEvent(new MessageEvent('message', { data: buffer }));
  }
}

class MockPeerConnection extends EventTarget {
  public localDescription: RTCSessionDescriptionInit | null;
  public readonly createdChannels: MockDataChannel[] = [];

  public constructor(type: 'offer' | 'answer') {
    super();
    this.localDescription = { type, sdp: '' };
  }

  public createDataChannel(label: string): RTCDataChannel {
    const channel = new MockDataChannel(label);
    this.createdChannels.push(channel);
    return channel as unknown as RTCDataChannel;
  }

  public fireDataChannel(channel: MockDataChannel): void {
    const event = new MessageEvent('datachannel', {
      data: undefined,
    }) as unknown as RTCDataChannelEvent;
    Object.defineProperty(event, 'channel', { value: channel, writable: false });
    this.dispatchEvent(event);
  }
}

class MockFileBus implements FileBus {
  public readonly emitted: unknown[] = [];
  private readonly jsonHandlers = new Set<(msg: unknown) => void>();

  sendJSON(m: unknown): void {
    this.emitted.push(m);
  }
  sendBinary(): void {}
  onJSON(handler: (m: unknown) => void): () => void {
    this.jsonHandlers.add(handler);
    return (): void => {
      this.jsonHandlers.delete(handler);
    };
  }
  onBinary(): () => void {
    return (): void => {};
  }
  close(): void {}

  emit(msg: unknown): void {
    for (const handler of this.jsonHandlers) {
      handler(msg);
    }
  }
}

const encoder: TextEncoder = new TextEncoder();

function encodeChunk(
  payload: Uint8Array,
  meta: { id: string; seq: number; totalChunks: number; totalBytes: number; last: boolean },
): ArrayBuffer {
  const header = {
    version: 1,
    id: meta.id,
    seq: meta.seq,
    totalChunks: meta.totalChunks,
    totalBytes: meta.totalBytes,
    chunkBytes: payload.byteLength,
    last: meta.last,
  };
  const headerBytes = encoder.encode(JSON.stringify(header));
  const buffer = new ArrayBuffer(4 + headerBytes.length + payload.byteLength);
  const view = new DataView(buffer);
  view.setUint32(0, headerBytes.length, false);
  new Uint8Array(buffer, 4, headerBytes.length).set(headerBytes);
  new Uint8Array(buffer, 4 + headerBytes.length).set(payload);
  return buffer;
}

function createEndpoint(pc: MockPeerConnection): RtcEndpoint {
  return {
    pc: pc as unknown as RTCPeerConnection,
    channel: new MockDataChannel('ctrl') as unknown as RTCDataChannel,
    sendJSON: vi.fn(),
    sendBinary: vi.fn(),
    onJSON: () => () => {},
    onBinary: () => () => {},
    close: vi.fn(),
    ready: Promise.resolve(),
  };
}

describe('FileTransfer (unit)', () => {
  it('sends data in configured chunks with backpressure and waits for ack', async () => {
    const pc = new MockPeerConnection('offer');
    const bus = new MockFileBus();
    const endpoint = createEndpoint(pc);
    const transfer = new FileTransfer(endpoint, bus, { chunkSize: 16 * 1024, lowWaterMark: 1024 });

    const channel = pc.createdChannels[0];
    expect(channel).toBeDefined();

    const size = 40 * 1024; // 40 KiB -> 3 chunks with 16 KiB default
    const payload = new Uint8Array(size).map((_, idx) => idx % 256);
    const file = new File([payload], 'big.bin', { type: 'application/octet-stream' });
    const meta: FileTransferMeta = {
      id: 'file-1',
      name: 'big.bin',
      size,
      addedAt: Date.now(),
    };

    const sendPromise = transfer.send(file, meta);

    // flush microtasks so start message is emitted
    await Promise.resolve();

    expect(bus.emitted[0]).toMatchObject({
      type: 'transfer:start',
      meta: expect.objectContaining({ id: 'file-1', size }),
      totalChunks: 3,
    });

    const drainTimer = setInterval(() => channel.drainAll(), 1);

    bus.emit({ type: 'transfer:ack', id: 'file-1' });

    await sendPromise;
    clearInterval(drainTimer);

    expect(channel.sent).toHaveLength(3);
    for (const buffer of channel.sent) {
      const view = new DataView(buffer);
      const headerLen = view.getUint32(0, false);
      const headerJson = new TextDecoder().decode(new Uint8Array(buffer, 4, headerLen));
      const header = JSON.parse(headerJson) as { chunkBytes: number };
      expect(header.chunkBytes).toBeLessThanOrEqual(16 * 1024);
    }
  });

  it('reassembles incoming chunks and acknowledges completion', async () => {
    const pc = new MockPeerConnection('answer');
    const bus = new MockFileBus();
    const endpoint = createEndpoint(pc);
    const transfer = new FileTransfer(endpoint, bus, { chunkSize: 8 * 1024 });
    const dataChannel = new MockDataChannel('file-data');
    pc.fireDataChannel(dataChannel);

    const received: Array<{ meta: FileTransferMeta; blob: Blob }> = [];
    transfer.onFile((event) => {
      if (event.status === 'complete') {
        received.push({ meta: event.meta, blob: event.blob });
      }
    });

    const totalBytes = 18 * 1024;
    bus.emit({
      type: 'transfer:start',
      meta: { id: 'alpha', name: 'alpha.bin', size: totalBytes, addedAt: 1 },
      totalChunks: 3,
      chunkSize: 8 * 1024,
      totalBytes,
    });

    const chunk1 = encodeChunk(new Uint8Array(8 * 1024).fill(1), {
      id: 'alpha',
      seq: 0,
      totalChunks: 3,
      totalBytes,
      last: false,
    });
    const chunk2 = encodeChunk(new Uint8Array(8 * 1024).fill(2), {
      id: 'alpha',
      seq: 1,
      totalChunks: 3,
      totalBytes,
      last: false,
    });
    const chunk3 = encodeChunk(new Uint8Array(2 * 1024).fill(3), {
      id: 'alpha',
      seq: 2,
      totalChunks: 3,
      totalBytes,
      last: true,
    });

    dataChannel.emitMessage(chunk1);
    dataChannel.emitMessage(chunk2);
    dataChannel.emitMessage(chunk3);

    await vi.waitFor(() => expect(received).toHaveLength(1));

    const event = received[0];
    expect(event.meta.id).toBe('alpha');
    expect(event.blob.size).toBe(totalBytes);
    expect(bus.emitted.some((m) => (m as { type?: string }).type === 'transfer:ack')).toBe(true);
  });

  it('cancels transfer on sequence mismatch', async () => {
    const pc = new MockPeerConnection('answer');
    const bus = new MockFileBus();
    const endpoint = createEndpoint(pc);
    const transfer = new FileTransfer(endpoint, bus);
    const dataChannel = new MockDataChannel('file-data');
    pc.fireDataChannel(dataChannel);

    const cancelled: FileTransferMeta[] = [];
    transfer.onFile((event) => {
      if (event.status === 'cancelled') cancelled.push(event.meta);
    });

    const totalBytes = 10 * 1024;
    bus.emit({
      type: 'transfer:start',
      meta: { id: 'oops', name: 'oops.bin', size: totalBytes },
      totalChunks: 2,
      chunkSize: 8 * 1024,
      totalBytes,
    });

    const good = encodeChunk(new Uint8Array(8 * 1024).fill(7), {
      id: 'oops',
      seq: 0,
      totalChunks: 2,
      totalBytes,
      last: false,
    });
    const bad = encodeChunk(new Uint8Array(1 * 1024).fill(9), {
      id: 'oops',
      seq: 2,
      totalChunks: 2,
      totalBytes,
      last: true,
    });

    dataChannel.emitMessage(good);
    dataChannel.emitMessage(bad);

    await vi.waitFor(() => expect(cancelled).toHaveLength(1));

    const cancelMessage = bus.emitted.find(
      (m) => (m as { type?: string }).type === 'transfer:cancel',
    );
    expect(cancelMessage).toMatchObject({ id: 'oops', reason: 'sequence_mismatch' });
  });
});
