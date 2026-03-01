import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { P2pChannel } from '../../../../bll/ports/p2p-channel';
import { createJsonCodec } from './codec';
import { MessageTransport } from './message-transport';
import {
  type ControlMsg,
  HASH_MODE_SHA256_END,
  type HelloCapabilities,
  PROTOCOL_ID,
} from './protocol';
import { FileExchangeSessionBuilder } from './session-builder';
import type { FileDesc, TransferTerminalEvent } from './types';
import {
  DATA_WIRE_HEADER_BYTES,
  decodeWire,
  encodeControlWire,
  encodeDataWire,
  newTransferId,
  transferIdTo16,
} from './wire';

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
    await delay(stepMs);
  }

  throw new Error('waitFor timeout');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function flushMicrotasks(rounds: number = 3): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
  }
}

function createNoopSink(): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write(): void {
      // no-op
    },
  });
}

function computeSha256Hex(payload: Uint8Array): string {
  return bytesToHex(sha256(payload));
}

async function sendInventorySnapshot(
  transport: MessageTransport,
  files: FileDesc[],
  maxBytes: number = 64 * 1024,
): Promise<void> {
  const codec = createJsonCodec({ maxBytes });
  const encoded = codec.encodeControl({
    p: PROTOCOL_ID,
    t: 'INVENTORY_SNAPSHOT',
    inventoryVersion: 0,
    files,
  });

  await transport.sendMessage(encodeControlWire(encoded), { priority: 'control' });
}

async function sendControlMsg(
  transport: MessageTransport,
  msg: ControlMsg,
  maxBytes: number = 64 * 1024,
): Promise<void> {
  const codec = createJsonCodec({ maxBytes });
  const encoded = codec.encodeControl(msg);
  await transport.sendMessage(encodeControlWire(encoded), { priority: 'control' });
}

function collectInboundControlMessages(
  transport: MessageTransport,
  maxBytes: number = 64 * 1024,
): {
  captures: Array<{ msg: ControlMsg; payloadBytes: number }>;
  dispose: () => void;
} {
  const codec = createJsonCodec({ maxBytes });
  const captures: Array<{ msg: ControlMsg; payloadBytes: number }> = [];

  const unsub = transport.onMessage((wireBytes) => {
    const wire = decodeWire(wireBytes);
    if (wire.k !== 'control') return;
    captures.push({ msg: codec.decodeControl(wire.bytes), payloadBytes: wire.bytes.length });
  });

  return {
    captures,
    dispose: unsub,
  };
}

interface NegotiationStateTest {
  status: 'pending' | 'established' | 'failed';
  settings: {
    protocol: string;
    maxMessageBytes: number;
    chunkBytes: number;
    maxFileBytes: number;
    hashMode: string | null;
    inventoryVersioning: boolean;
    inventoryPaging: boolean;
  };
  peerSessionId?: string;
  reason?: string;
}

function readNegotiation(session: unknown): NegotiationStateTest {
  return (session as { negotiation: NegotiationStateTest }).negotiation;
}

function createFx2Caps(overrides?: {
  maxMessageBytes?: number;
  chunkBytes?: number;
  maxFileBytes?: number;
  hashModes?: HelloCapabilities['hash']['modes'];
  inventoryVersioning?: boolean;
  inventoryPaging?: boolean;
}): HelloCapabilities {
  return {
    maxMessageBytes: overrides?.maxMessageBytes ?? 128 * 1024,
    chunkBytes: overrides?.chunkBytes ?? 32 * 1024,
    maxFileBytes: overrides?.maxFileBytes ?? 128 * 1024 * 1024,
    hash: {
      algorithms: ['sha256'],
      modes: overrides?.hashModes ?? [HASH_MODE_SHA256_END],
    },
    inventory: {
      versioning: overrides?.inventoryVersioning ?? true,
      paging: overrides?.inventoryPaging ?? true,
    },
  };
}

describe('FileExchangeSessionBuilder', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fails with META_TIMEOUT and emits one terminal failure event', async () => {
    const { a, b } = createLinkedChannels();

    const peerTransport = new MessageTransport(a, { maxMessageBytes: 256 * 1024 });
    const receiver = new FileExchangeSessionBuilder(b, {
      metaTimeoutMs: 40,
      idleTimeoutMs: 1_000,
      hardTimeoutMs: null,
    }).build();

    const terminals: TransferTerminalEvent[] = [];
    receiver.onTransferTerminal((event) => terminals.push(event));

    await sendInventorySnapshot(peerTransport, [
      { id: 'f1', name: 'x.bin', size: 5, mime: 'application/octet-stream' },
    ]);

    await waitFor(() => receiver.peerFiles().length === 1);

    const sink = new WritableStream<Uint8Array>({
      write(): void {
        // no-op
      },
    });

    const handle = receiver.requestDownloadTo('f1', sink);

    await expect(handle.done).rejects.toMatchObject({ code: 'META_TIMEOUT' });

    await waitFor(() => terminals.some((event) => event.transferId === handle.transferId));

    const byTransfer = terminals.filter((event) => event.transferId === handle.transferId);
    expect(byTransfer).toHaveLength(1);
    expect(byTransfer[0]?.status).toBe('failed');
    if (byTransfer[0]?.status === 'failed') {
      expect(byTransfer[0].code).toBe('META_TIMEOUT');
    }

    receiver.dispose();
    await peerTransport.dispose();
  });

  it('completes zero-length files without data frames', async () => {
    const { a, b } = createLinkedChannels();

    const sender = new FileExchangeSessionBuilder(a).build();
    const receiver = new FileExchangeSessionBuilder(b).build();

    const terminals: TransferTerminalEvent[] = [];
    receiver.onTransferTerminal((event) => terminals.push(event));

    await waitFor(
      () =>
        readNegotiation(sender).status === 'established' &&
        readNegotiation(receiver).status === 'established',
    );

    await sender.addLocal([new File([''], 'zero.txt', { type: 'text/plain' })]);

    const senderFiles = sender.localFiles();
    (receiver as unknown as { peerIndex: FileDesc[] }).peerIndex = senderFiles.map((file) => ({
      ...file,
    }));

    const receivedChunks: Uint8Array[] = [];
    const sink = new WritableStream<Uint8Array>({
      write(chunk: Uint8Array): void {
        receivedChunks.push(chunk);
      },
    });

    const fileId = senderFiles[0]?.id;
    expect(fileId).toBeDefined();
    if (!fileId) throw new Error('Expected fileId to be defined');

    const handle = receiver.requestDownloadTo(fileId, sink);
    await handle.done;

    expect(receivedChunks).toHaveLength(0);

    const byTransfer = terminals.filter((event) => event.transferId === handle.transferId);
    expect(byTransfer).toHaveLength(1);
    expect(byTransfer[0]?.status).toBe('completed');

    sender.dispose();
    receiver.dispose();
  });

  it('emits cancellation terminal once and does not emit transfer error on user cancel', async () => {
    const { a, b } = createLinkedChannels();

    const sender = new FileExchangeSessionBuilder(a, {
      fileChunkBytes: 1024,
    }).build();

    const receiver = new FileExchangeSessionBuilder(b, {
      fileChunkBytes: 1024,
    }).build();

    const transferErrors: string[] = [];
    const senderTerminals: TransferTerminalEvent[] = [];
    const terminals: TransferTerminalEvent[] = [];

    sender.onTransferTerminal((event) => {
      senderTerminals.push(event);
    });

    receiver.onError((error) => {
      if (error.scope === 'transfer' && error.transferId) {
        transferErrors.push(error.transferId);
      }
    });

    receiver.onTransferTerminal((event) => {
      terminals.push(event);
    });

    await waitFor(
      () =>
        readNegotiation(sender).status === 'established' &&
        readNegotiation(receiver).status === 'established',
    );

    const payload = new Uint8Array(512 * 1024);
    payload.fill(7);

    await sender.addLocal([new File([payload], 'large.bin', { type: 'application/octet-stream' })]);

    const senderFiles = sender.localFiles();
    (receiver as unknown as { peerIndex: FileDesc[] }).peerIndex = senderFiles.map((file) => ({
      ...file,
    }));

    const sink = new WritableStream<Uint8Array>({
      async write(): Promise<void> {
        await delay(5);
      },
    });

    const fileId = senderFiles[0]?.id;
    expect(fileId).toBeDefined();
    if (!fileId) throw new Error('Expected fileId to be defined');

    const handle = receiver.requestDownloadTo(fileId, sink);
    handle.cancel();

    await expect(handle.done).rejects.toThrow(/cancelled by user/i);

    await waitFor(() => terminals.some((event) => event.transferId === handle.transferId));

    const byTransfer = terminals.filter((event) => event.transferId === handle.transferId);
    expect(byTransfer).toHaveLength(1);
    expect(byTransfer[0]?.status).toBe('cancelled');

    await waitFor(() => senderTerminals.some((event) => event.transferId === handle.transferId));

    const senderByTransfer = senderTerminals.filter(
      (event) => event.transferId === handle.transferId,
    );
    expect(senderByTransfer).toHaveLength(1);
    expect(senderByTransfer[0]?.status).toBe('cancelled');

    expect(transferErrors).not.toContain(handle.transferId);

    sender.dispose();
    receiver.dispose();
  });

  it('uses default hard timeout when hardTimeoutMs is undefined', async () => {
    vi.useFakeTimers();

    const { b } = createLinkedChannels();
    const receiver = new FileExchangeSessionBuilder(b, {
      metaTimeoutMs: 12 * 60 * 60 * 1000,
      idleTimeoutMs: 12 * 60 * 60 * 1000,
    }).build();

    (receiver as unknown as { peerIndex: FileDesc[] }).peerIndex = [
      { id: 'f1', name: 'x.bin', size: 5, mime: 'application/octet-stream' },
    ];

    const handle = receiver.requestDownloadTo('f1', createNoopSink());

    let doneResult: unknown;
    void handle.done.then(
      () => {
        doneResult = 'completed';
      },
      (error) => {
        doneResult = error;
      },
    );

    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 - 1);
    await flushMicrotasks();
    expect(doneResult).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1);
    await flushMicrotasks();
    expect(doneResult).toMatchObject({ code: 'HARD_TIMEOUT' });

    receiver.dispose();
  });

  it('disables hard timeout when hardTimeoutMs is null', async () => {
    vi.useFakeTimers();

    const { b } = createLinkedChannels();
    const receiver = new FileExchangeSessionBuilder(b, {
      metaTimeoutMs: 12 * 60 * 60 * 1000,
      idleTimeoutMs: 12 * 60 * 60 * 1000,
      hardTimeoutMs: null,
    }).build();

    (receiver as unknown as { peerIndex: FileDesc[] }).peerIndex = [
      { id: 'f1', name: 'x.bin', size: 5, mime: 'application/octet-stream' },
    ];

    const handle = receiver.requestDownloadTo('f1', createNoopSink());

    let doneResult: unknown;
    void handle.done.then(
      () => {
        doneResult = 'completed';
      },
      (error) => {
        doneResult = error;
      },
    );

    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 + 1);
    await flushMicrotasks();
    expect(doneResult).toBeUndefined();

    handle.cancel();
    await expect(handle.done).rejects.toThrow(/cancelled by user/i);

    receiver.dispose();
  });

  it('enables hard timeout when hardTimeoutMs is a positive number', async () => {
    vi.useFakeTimers();

    const { b } = createLinkedChannels();
    const receiver = new FileExchangeSessionBuilder(b, {
      metaTimeoutMs: 60_000,
      idleTimeoutMs: 60_000,
      hardTimeoutMs: 50,
    }).build();

    (receiver as unknown as { peerIndex: FileDesc[] }).peerIndex = [
      { id: 'f1', name: 'x.bin', size: 5, mime: 'application/octet-stream' },
    ];

    const handle = receiver.requestDownloadTo('f1', createNoopSink());
    const done = handle.done;
    void done.catch(() => {});
    await vi.advanceTimersByTimeAsync(50);
    await flushMicrotasks();

    await expect(done).rejects.toMatchObject({ code: 'HARD_TIMEOUT' });
    receiver.dispose();
  });

  it('rejects DATA frames received before FILE_META', async () => {
    const { a, b } = createLinkedChannels();

    const peerTransport = new MessageTransport(a, { maxMessageBytes: 256 * 1024 });
    const receiver = new FileExchangeSessionBuilder(b, {
      metaTimeoutMs: 500,
      idleTimeoutMs: 1_000,
      hardTimeoutMs: null,
    }).build();

    const terminals: TransferTerminalEvent[] = [];
    receiver.onTransferTerminal((event) => terminals.push(event));

    await sendInventorySnapshot(peerTransport, [
      { id: 'f1', name: 'x.bin', size: 5, mime: 'application/octet-stream' },
    ]);

    await waitFor(() => receiver.peerFiles().length === 1);

    const handle = receiver.requestDownloadTo('f1', createNoopSink());

    await peerTransport.sendMessage(
      encodeDataWire({
        transferId16: transferIdTo16(handle.transferId),
        seq: 0,
        eof: false,
        payload: new Uint8Array([1, 2, 3]),
      }),
      { priority: 'data' },
    );

    await expect(handle.done).rejects.toMatchObject({ code: 'PROTOCOL_VIOLATION' });
    await waitFor(() => terminals.some((event) => event.transferId === handle.transferId));

    const byTransfer = terminals.filter((event) => event.transferId === handle.transferId);
    expect(byTransfer).toHaveLength(1);
    expect(byTransfer[0]?.status).toBe('failed');
    if (byTransfer[0]?.status === 'failed') {
      expect(byTransfer[0].code).toBe('PROTOCOL_VIOLATION');
    }

    receiver.dispose();
    await peerTransport.dispose();
  });

  it('fails fast when transportMaxMessageBytes cannot fit encoded control/data messages', () => {
    const { b } = createLinkedChannels();

    expect(() =>
      new FileExchangeSessionBuilder(b, {
        controlMaxBytes: 1_024,
        fileChunkBytes: 1_024,
        transportMaxMessageBytes: 1_000,
      }).build(),
    ).toThrow(/transportMaxMessageBytes/i);
  });

  it('accepts config when transportMaxMessageBytes matches required minimum', () => {
    const { b } = createLinkedChannels();

    const controlMaxBytes = 1_024;
    const fileChunkBytes = 1_024;
    const minRequired = Math.max(1 + controlMaxBytes, DATA_WIRE_HEADER_BYTES + fileChunkBytes);

    const session = new FileExchangeSessionBuilder(b, {
      controlMaxBytes,
      fileChunkBytes,
      transportMaxMessageBytes: minRequired,
    }).build();

    session.dispose();
  });

  it('negotiates fx/2 and derives shared limits', async () => {
    const { a, b } = createLinkedChannels();

    const left = new FileExchangeSessionBuilder(a, {
      transportMaxMessageBytes: 70_000,
      fileChunkBytes: 8_000,
      maxFileBytes: 9_000,
    }).build();

    const right = new FileExchangeSessionBuilder(b, {
      transportMaxMessageBytes: 90_000,
      fileChunkBytes: 4_000,
      maxFileBytes: 7_000,
    }).build();

    await waitFor(
      () =>
        readNegotiation(left).status === 'established' &&
        readNegotiation(right).status === 'established',
    );

    const leftNegotiation = readNegotiation(left);
    const rightNegotiation = readNegotiation(right);

    expect(leftNegotiation.settings.protocol).toBe(PROTOCOL_ID);
    expect(rightNegotiation.settings.protocol).toBe(PROTOCOL_ID);

    expect(leftNegotiation.settings.maxMessageBytes).toBe(70_000);
    expect(rightNegotiation.settings.maxMessageBytes).toBe(70_000);

    expect(leftNegotiation.settings.chunkBytes).toBe(4_000);
    expect(rightNegotiation.settings.chunkBytes).toBe(4_000);

    expect(leftNegotiation.settings.maxFileBytes).toBe(7_000);
    expect(rightNegotiation.settings.maxFileBytes).toBe(7_000);

    expect(leftNegotiation.settings.hashMode).toBe(HASH_MODE_SHA256_END);
    expect(rightNegotiation.settings.hashMode).toBe(HASH_MODE_SHA256_END);
    expect(leftNegotiation.settings.inventoryVersioning).toBe(true);
    expect(rightNegotiation.settings.inventoryVersioning).toBe(true);
    expect(leftNegotiation.settings.inventoryPaging).toBe(true);
    expect(rightNegotiation.settings.inventoryPaging).toBe(true);

    left.dispose();
    right.dispose();
  });

  it('fails with NEGOTIATION_FAILED when HELLO omits capability payload', async () => {
    const { a, b } = createLinkedChannels();

    const peerTransport = new MessageTransport(a, { maxMessageBytes: 256 * 1024 });
    const receiver = new FileExchangeSessionBuilder(b).build();

    const errors: string[] = [];
    receiver.onError((error) => {
      if (error.scope === 'session') {
        errors.push(error.code);
      }
    });

    await sendControlMsg(peerTransport, {
      p: PROTOCOL_ID,
      t: 'HELLO',
      sessionId: 'peer',
      appBuildId: 'dev-build',
    });

    await waitFor(() => receiver.state() === 'closed');
    expect(errors).toContain('NEGOTIATION_FAILED');
    await peerTransport.dispose();
  });

  it('fails with BUILD_MISMATCH when HELLO build id differs', async () => {
    const { a, b } = createLinkedChannels();

    const peerTransport = new MessageTransport(a, { maxMessageBytes: 256 * 1024 });
    const receiver = new FileExchangeSessionBuilder(b, {
      appBuildId: 'build-local',
    }).build();

    const sessionErrors: string[] = [];
    receiver.onError((error) => {
      if (error.scope === 'session') {
        sessionErrors.push(error.code);
      }
    });

    await sendControlMsg(peerTransport, {
      p: PROTOCOL_ID,
      t: 'HELLO',
      sessionId: 'peer',
      appBuildId: 'build-remote',
      caps: createFx2Caps(),
    });

    await waitFor(() => receiver.state() === 'closed');
    expect(sessionErrors).toContain('BUILD_MISMATCH');

    await peerTransport.dispose();
  });

  it('accepts repeated HELLO with stable negotiated settings', async () => {
    const { a, b } = createLinkedChannels();

    const peerTransport = new MessageTransport(a, { maxMessageBytes: 256 * 1024 });
    const receiver = new FileExchangeSessionBuilder(b).build();

    const sessionErrors: string[] = [];
    receiver.onError((error) => {
      if (error.scope === 'session') {
        sessionErrors.push(error.code);
      }
    });

    const caps = createFx2Caps({
      maxMessageBytes: 128 * 1024,
      chunkBytes: 64 * 1024,
      maxFileBytes: 500 * 1024 * 1024,
    });

    const hello: ControlMsg = {
      p: PROTOCOL_ID,
      t: 'HELLO',
      sessionId: 'peer',
      appBuildId: 'dev-build',
      caps,
    };

    await sendControlMsg(peerTransport, hello);
    await waitFor(() => readNegotiation(receiver).status === 'established');

    const before = readNegotiation(receiver).settings;
    await sendControlMsg(peerTransport, hello);
    await delay(20);

    const after = readNegotiation(receiver).settings;
    expect(after).toEqual(before);
    expect(sessionErrors).not.toContain('NEGOTIATION_FAILED');
    expect(receiver.state()).toBe('ready');

    receiver.dispose();
    await peerTransport.dispose();
  });

  it('requests inventory resync on delta version mismatch and heals from snapshot', async () => {
    const { a, b } = createLinkedChannels();

    const peerTransport = new MessageTransport(a, { maxMessageBytes: 256 * 1024 });
    const receiver = new FileExchangeSessionBuilder(b).build();
    const outbound = collectInboundControlMessages(peerTransport);

    await sendControlMsg(peerTransport, {
      p: PROTOCOL_ID,
      t: 'HELLO',
      sessionId: 'peer',
      appBuildId: 'dev-build',
      caps: createFx2Caps(),
    });

    await waitFor(() => readNegotiation(receiver).status === 'established');

    await sendControlMsg(peerTransport, {
      p: PROTOCOL_ID,
      t: 'INVENTORY_SNAPSHOT',
      inventoryVersion: 1,
      files: [{ id: 'f1', name: 'one.txt', size: 1, mime: 'text/plain' }],
    });

    await waitFor(() => receiver.peerFiles().length === 1);

    await sendControlMsg(peerTransport, {
      p: PROTOCOL_ID,
      t: 'INVENTORY_DELTA',
      baseVersion: 0,
      nextVersion: 1,
      add: [{ id: 'f2', name: 'two.txt', size: 2, mime: 'text/plain' }],
    });

    await waitFor(() =>
      outbound.captures.some(
        (capture) =>
          capture.msg.t === 'INVENTORY_RESYNC_REQUEST' &&
          capture.msg.reason?.includes('delta_base_version_mismatch'),
      ),
    );

    await sendControlMsg(peerTransport, {
      p: PROTOCOL_ID,
      t: 'INVENTORY_SNAPSHOT',
      inventoryVersion: 2,
      files: [{ id: 'f3', name: 'healed.txt', size: 3, mime: 'text/plain' }],
    });

    await waitFor(() => receiver.peerFiles().length === 1 && receiver.peerFiles()[0]?.id === 'f3');

    outbound.dispose();
    receiver.dispose();
    await peerTransport.dispose();
  });

  it('applies paged snapshots atomically after begin/part/end reassembly', async () => {
    const { a, b } = createLinkedChannels();

    const peerTransport = new MessageTransport(a, { maxMessageBytes: 256 * 1024 });
    const receiver = new FileExchangeSessionBuilder(b).build();

    await sendControlMsg(peerTransport, {
      p: PROTOCOL_ID,
      t: 'HELLO',
      sessionId: 'peer',
      appBuildId: 'dev-build',
      caps: createFx2Caps(),
    });

    await waitFor(() => readNegotiation(receiver).status === 'established');

    await sendControlMsg(peerTransport, {
      p: PROTOCOL_ID,
      t: 'INVENTORY_SNAPSHOT_BEGIN',
      snapshotId: 'snap-1',
      inventoryVersion: 4,
      totalParts: 2,
    });

    await sendControlMsg(peerTransport, {
      p: PROTOCOL_ID,
      t: 'INVENTORY_SNAPSHOT_PART',
      snapshotId: 'snap-1',
      partIndex: 1,
      files: [{ id: 'b', name: 'b.txt', size: 2, mime: 'text/plain' }],
    });

    await sendControlMsg(peerTransport, {
      p: PROTOCOL_ID,
      t: 'INVENTORY_SNAPSHOT_PART',
      snapshotId: 'snap-1',
      partIndex: 0,
      files: [{ id: 'a', name: 'a.txt', size: 1, mime: 'text/plain' }],
    });

    await delay(20);
    expect(receiver.peerFiles()).toHaveLength(0);

    await sendControlMsg(peerTransport, {
      p: PROTOCOL_ID,
      t: 'INVENTORY_SNAPSHOT_END',
      snapshotId: 'snap-1',
      inventoryVersion: 4,
      totalParts: 2,
    });

    await waitFor(() => receiver.peerFiles().length === 2);
    expect(receiver.peerFiles().map((file) => file.id)).toEqual(['a', 'b']);

    receiver.dispose();
    await peerTransport.dispose();
  });

  it('sends debounced versioned inventory deltas that stay within controlMaxBytes', async () => {
    const { a, b } = createLinkedChannels();

    const controlMaxBytes = 300;
    const transportMaxMessageBytes = 2_048;

    const peerTransport = new MessageTransport(a, { maxMessageBytes: transportMaxMessageBytes });
    const sender = new FileExchangeSessionBuilder(b, {
      controlMaxBytes,
      fileChunkBytes: 256,
      transportMaxMessageBytes,
    }).build();

    const outbound = collectInboundControlMessages(peerTransport, controlMaxBytes);

    await sendControlMsg(peerTransport, {
      p: PROTOCOL_ID,
      t: 'HELLO',
      sessionId: 'peer',
      appBuildId: 'dev-build',
      caps: createFx2Caps({
        maxMessageBytes: transportMaxMessageBytes,
        chunkBytes: 256,
      }),
    });

    await waitFor(() => readNegotiation(sender).status === 'established');

    await sender.addLocal([
      new File(['alpha'], 'alpha.txt', { type: 'text/plain' }),
      new File(['beta'], 'beta.txt', { type: 'text/plain' }),
      new File(['gamma'], 'gamma.txt', { type: 'text/plain' }),
    ]);

    await waitFor(() => outbound.captures.some((capture) => capture.msg.t === 'INVENTORY_DELTA'));

    const deltas = outbound.captures.filter(
      (
        capture,
      ): capture is { msg: Extract<ControlMsg, { t: 'INVENTORY_DELTA' }>; payloadBytes: number } =>
        capture.msg.t === 'INVENTORY_DELTA',
    );

    expect(deltas.length).toBeGreaterThan(0);

    let expectedBaseVersion = 0;
    const addedIds: string[] = [];

    for (const delta of deltas) {
      expect(delta.payloadBytes).toBeLessThanOrEqual(controlMaxBytes);
      expect(delta.msg.baseVersion).toBe(expectedBaseVersion);
      expect(delta.msg.nextVersion).toBe(expectedBaseVersion + 1);
      expectedBaseVersion += 1;
      addedIds.push(...(delta.msg.add?.map((file) => file.id) ?? []));
    }

    expect(addedIds.length).toBe(3);

    outbound.dispose();
    sender.dispose();
    await peerTransport.dispose();
  });

  it('sends FILE_END with SHA-256 hash when negotiated hash mode is enabled', async () => {
    const { a, b } = createLinkedChannels();

    const peerTransport = new MessageTransport(a, { maxMessageBytes: 256 * 1024 });
    const sender = new FileExchangeSessionBuilder(b).build();
    const outbound = collectInboundControlMessages(peerTransport);

    await sendControlMsg(peerTransport, {
      p: PROTOCOL_ID,
      t: 'HELLO',
      sessionId: 'peer',
      appBuildId: 'dev-build',
      caps: createFx2Caps(),
    });

    await waitFor(() => readNegotiation(sender).status === 'established');

    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
    await sender.addLocal([new File([payload], 'hash.bin', { type: 'application/octet-stream' })]);

    const fileId = sender.localFiles()[0]?.id;
    expect(fileId).toBeDefined();
    if (!fileId) throw new Error('Expected fileId to be defined');

    const { transferId } = newTransferId();
    await sendControlMsg(peerTransport, {
      p: PROTOCOL_ID,
      t: 'GET_FILE',
      transferId,
      fileId,
    });

    await waitFor(() =>
      outbound.captures.some(
        (capture) => capture.msg.t === 'FILE_END' && capture.msg.transferId === transferId,
      ),
    );

    const fileEnd = outbound.captures.find(
      (capture): capture is { msg: Extract<ControlMsg, { t: 'FILE_END' }>; payloadBytes: number } =>
        capture.msg.t === 'FILE_END' && capture.msg.transferId === transferId,
    )?.msg;

    expect(fileEnd?.hash).toEqual({
      alg: 'sha256',
      value: computeSha256Hex(payload),
    });

    outbound.dispose();
    sender.dispose();
    await peerTransport.dispose();
  });

  it('fails transfer with HASH_MISMATCH when FILE_END hash differs from streamed content', async () => {
    const { a, b } = createLinkedChannels();

    const peerTransport = new MessageTransport(a, { maxMessageBytes: 256 * 1024 });
    const receiver = new FileExchangeSessionBuilder(b).build();
    const terminals: TransferTerminalEvent[] = [];

    receiver.onTransferTerminal((event) => terminals.push(event));

    await sendControlMsg(peerTransport, {
      p: PROTOCOL_ID,
      t: 'HELLO',
      sessionId: 'peer',
      appBuildId: 'dev-build',
      caps: createFx2Caps(),
    });

    await waitFor(() => readNegotiation(receiver).status === 'established');

    await sendControlMsg(peerTransport, {
      p: PROTOCOL_ID,
      t: 'INVENTORY_SNAPSHOT',
      inventoryVersion: 1,
      files: [{ id: 'f1', name: 'mismatch.bin', size: 3, mime: 'application/octet-stream' }],
    });

    await waitFor(() => receiver.peerFiles().length === 1);

    const handle = receiver.requestDownloadTo('f1', createNoopSink());
    const payload = new Uint8Array([9, 8, 7]);

    await sendControlMsg(peerTransport, {
      p: PROTOCOL_ID,
      t: 'FILE_META',
      transferId: handle.transferId,
      file: {
        id: 'f1',
        name: 'mismatch.bin',
        size: payload.length,
        mime: 'application/octet-stream',
      },
    });

    await peerTransport.sendMessage(
      encodeDataWire({
        transferId16: transferIdTo16(handle.transferId),
        seq: 0,
        eof: false,
        payload,
      }),
      { priority: 'data' },
    );

    await sendControlMsg(peerTransport, {
      p: PROTOCOL_ID,
      t: 'FILE_END',
      transferId: handle.transferId,
      hash: {
        alg: 'sha256',
        value: '0000000000000000000000000000000000000000000000000000000000000000',
      },
    });

    await expect(handle.done).rejects.toMatchObject({ code: 'HASH_MISMATCH' });
    await waitFor(() => terminals.some((event) => event.transferId === handle.transferId));

    const terminal = terminals.find((event) => event.transferId === handle.transferId);
    expect(terminal?.status).toBe('failed');
    if (terminal?.status === 'failed') {
      expect(terminal.code).toBe('HASH_MISMATCH');
    }

    receiver.dispose();
    await peerTransport.dispose();
  });
});
