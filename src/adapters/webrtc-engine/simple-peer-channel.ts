import type { P2pChannel } from '../../bll/ports/p2p-channel';

const encoder = new TextEncoder();

type PeerInstance = import('simple-peer').Instance;

function toUint8(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);

  if (typeof data === 'string') return encoder.encode(data);

  // simple-peer может эмитить Object, если пришла JSON-строка
  return encoder.encode(JSON.stringify(data));
}

export class SimplePeerChannel implements P2pChannel {
  private readonly peer: PeerInstance;

  constructor(peer: PeerInstance) {
    this.peer = peer;
  }

  send(data: Uint8Array): void {
    this.peer.send(data);
  }

  onReceive(cb: (data: Uint8Array) => void): () => void {
    const handler = (data: unknown) => cb(toUint8(data));

    this.peer.on('data', handler);

    return () => {
      this.peer.removeListener('data', handler);
    };
  }
}
