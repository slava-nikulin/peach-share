export interface P2pChannel {
  send(data: Uint8Array): void;
  onReceive(cb: (data: Uint8Array) => void): () => void;
}
