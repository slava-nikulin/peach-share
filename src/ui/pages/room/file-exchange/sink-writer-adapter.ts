import type { TransferFailureCode } from './types';

type TransferErrorFactory = (
  code: TransferFailureCode,
  message: string,
  cause?: unknown,
) => Error;

export type InMemorySinkWriter = {
  sink: WritableStream<Uint8Array>;
  toBlob: (mime: string) => Blob;
  clear: () => void;
};

export function createInMemorySinkWriter(
  maxBytes: number,
  createError: TransferErrorFactory,
): InMemorySinkWriter {
  const chunks: Uint8Array[] = [];
  let total = 0;

  return {
    sink: new WritableStream<Uint8Array>({
      write(chunk): void {
        const nextTotal = total + chunk.length;
        if (nextTotal > maxBytes) {
          throw createError(
            'LIMIT_MEMORY_DOWNLOAD',
            `in-memory download exceeds maxInMemoryDownloadBytes=${maxBytes}`,
          );
        }

        total = nextTotal;
        chunks.push(chunk.slice());
      },
      abort(): void {
        chunks.length = 0;
        total = 0;
      },
      close(): void {
        // no-op
      },
    }),

    toBlob(mime: string): Blob {
      return new Blob(chunks as BlobPart[], { type: mime || 'application/octet-stream' });
    },

    clear(): void {
      chunks.length = 0;
      total = 0;
    },
  };
}
