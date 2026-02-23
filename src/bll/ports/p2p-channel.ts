export interface P2pChannel {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close(): void;
  onClose(cb: () => void): () => void;
}
