import type Peer from 'simple-peer';
import type { P2pChannel } from '../../bll/ports/p2p-channel';

const encoder = new TextEncoder();

function toUint8(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);

  if (typeof data === 'string') return encoder.encode(data);

  // simple-peer может эмитить Object, если пришла JSON-строка
  return encoder.encode(JSON.stringify(data));
}

export class SimplePeerChannel implements P2pChannel {
  constructor(private readonly peer: Peer.Instance) {}

  send(data: Uint8Array): void {
    // simple-peer поддерживает TypedArrayView (Uint8Array) напрямую
    this.peer.send(data as any);
  }

  onReceive(cb: (data: Uint8Array) => void): () => void {
    const handler = (data: unknown) => cb(toUint8(data));

    this.peer.on('data', handler);

    return () => {
      (this.peer as any).off?.('data', handler);
      (this.peer as any).removeListener?.('data', handler);
    };
  }
}
