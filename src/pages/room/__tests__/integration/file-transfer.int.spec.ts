import { afterAll, describe, expect, it, vi } from 'vitest';
import type { RtcEndpoint } from '../../../../lib/webrtc';
import { FileTransfer, type FileTransferMeta } from '../../components/room-files/file-transfer';

function toEndpoint(pc: RTCPeerConnection, channel: RTCDataChannel): RtcEndpoint {
  const jsonHandlers = new Set<(msg: unknown) => void>();
  const binHandlers = new Set<(buf: ArrayBuffer) => void>();

  const handleMessage = (event: MessageEvent): void => {
    if (typeof event.data === 'string') {
      try {
        const parsed = JSON.parse(event.data);
        for (const fn of jsonHandlers) {
          fn(parsed);
        }
      } catch {
        // ignore
      }
    } else if (event.data instanceof ArrayBuffer) {
      for (const fn of binHandlers) {
        fn(event.data as ArrayBuffer);
      }
    } else if (event.data instanceof Blob) {
      event.data.arrayBuffer().then((buf) => {
        for (const fn of binHandlers) {
          fn(buf);
        }
      });
    }
  };

  channel.addEventListener('message', handleMessage);

  return {
    pc,
    channel,
    sendJSON(payload: unknown): void {
      channel.send(JSON.stringify(payload));
    },
    sendBinary(buf: ArrayBuffer | ArrayBufferView): void {
      if (buf instanceof ArrayBuffer) {
        channel.send(buf);
        return;
      }
      if (ArrayBuffer.isView(buf)) {
        const view = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        const copy = new Uint8Array(view.byteLength);
        copy.set(view);
        channel.send(copy);
        return;
      }
    },
    onJSON(handler: (msg: unknown) => void): () => void {
      jsonHandlers.add(handler);
      return () => jsonHandlers.delete(handler);
    },
    onBinary(handler: (buf: ArrayBuffer) => void): () => void {
      binHandlers.add(handler);
      return () => binHandlers.delete(handler);
    },
    close(): void {
      try {
        channel.removeEventListener('message', handleMessage);
        channel.close();
      } catch {}
      try {
        pc.close();
      } catch {}
    },
    ready: Promise.resolve(),
  };
}

async function wirePeers(a: RTCPeerConnection, b: RTCPeerConnection): Promise<void> {
  a.addEventListener('icecandidate', (event) => {
    if (event.candidate) void b.addIceCandidate(event.candidate);
  });
  b.addEventListener('icecandidate', (event) => {
    if (event.candidate) void a.addIceCandidate(event.candidate);
  });

  const offer = await a.createOffer();
  await a.setLocalDescription(offer);
  await b.setRemoteDescription(offer);

  const answer = await b.createAnswer();
  await b.setLocalDescription(answer);
  await a.setRemoteDescription(answer);

  await Promise.all([
    new Promise<void>((resolve) => {
      if (a.iceConnectionState === 'connected' || a.iceConnectionState === 'completed') {
        resolve();
        return;
      }
      const handler = (): void => {
        if (a.iceConnectionState === 'connected' || a.iceConnectionState === 'completed') {
          a.removeEventListener('iceconnectionstatechange', handler);
          resolve();
        }
      };
      a.addEventListener('iceconnectionstatechange', handler);
    }),
    new Promise<void>((resolve) => {
      if (b.iceConnectionState === 'connected' || b.iceConnectionState === 'completed') {
        resolve();
        return;
      }
      const handler = (): void => {
        if (b.iceConnectionState === 'connected' || b.iceConnectionState === 'completed') {
          b.removeEventListener('iceconnectionstatechange', handler);
          resolve();
        }
      };
      b.addEventListener('iceconnectionstatechange', handler);
    }),
  ]);
}

describe('FileTransfer integration', () => {
  it('transfers a file end-to-end between peers', async () => {
    const pcOwner = new RTCPeerConnection();
    const pcGuest = new RTCPeerConnection();

    const ctrlOwner = pcOwner.createDataChannel('meta', { ordered: true });
    let ctrlGuest: RTCDataChannel | null = null;
    const onDatachannel = vi.fn((event: RTCDataChannelEvent) => {
      if (event.channel.label === 'meta') {
        ctrlGuest = event.channel;
      }
    });
    pcGuest.addEventListener('datachannel', onDatachannel);

    await wirePeers(pcOwner, pcGuest);

    await Promise.all([
      new Promise<void>((resolve) => {
        if (ctrlOwner.readyState === 'open') {
          resolve();
          return;
        }
        ctrlOwner.addEventListener('open', () => resolve(), { once: true });
      }),
      new Promise<void>((resolve) => {
        const wait = (): void => {
          if (ctrlGuest && ctrlGuest.readyState === 'open') {
            resolve();
          } else {
            setTimeout(wait, 10);
          }
        };
        wait();
      }),
    ]);

    if (!ctrlGuest) throw new Error('guest control channel not established');

    const endpointOwner = toEndpoint(pcOwner, ctrlOwner);
    const endpointGuest = toEndpoint(pcGuest, ctrlGuest);

    const guestTransfer = new FileTransfer(endpointGuest);
    const ownerTransfer = new FileTransfer(endpointOwner, undefined, {
      chunkSize: 16 * 1024,
      lowWaterMark: 256 * 1024,
    });

    const received: Array<{ meta: FileTransferMeta; blob: Blob }> = [];
    guestTransfer.onFile((event) => {
      if (event.status === 'complete') {
        received.push({ meta: event.meta, blob: event.blob });
      }
    });

    const total = 128 * 1024 + 11;
    const content = new Uint8Array(total);
    content.forEach((_, idx) => {
      content[idx] = idx % 251;
    });
    const file = new File([content], 'integration.bin', { type: 'application/octet-stream' });
    const meta: FileTransferMeta = {
      id: 'integration-file',
      name: 'integration.bin',
      size: total,
    };

    const sendPromise = ownerTransfer.send(file, meta);

    await vi.waitFor(() => expect(received).toHaveLength(1), 120_000);
    await sendPromise;

    const delivered = received[0];
    expect(delivered.meta.id).toBe('integration-file');
    expect(delivered.blob.size).toBe(total);
    const arrayBuffer = await delivered.blob.arrayBuffer();
    expect(new Uint8Array(arrayBuffer)).toEqual(content);

    ownerTransfer.dispose();
    guestTransfer.dispose();
    endpointOwner.close();
    endpointGuest.close();
    pcGuest.removeEventListener('datachannel', onDatachannel);
  });

  afterAll(() => {
    // ensure no leftover object URLs in case of failures
    if (globalThis.URL && 'revokeObjectURL' in URL) {
      // nothing to do but placeholder for completeness
    }
  });
});
