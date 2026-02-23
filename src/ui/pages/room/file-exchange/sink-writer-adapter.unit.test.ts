import { describe, expect, it } from 'vitest';
import { createInMemorySinkWriter } from './sink-writer-adapter';

describe('sink writer adapter', () => {
  it('collects chunks and materializes blob', async () => {
    const sinkWriter = createInMemorySinkWriter(16, createTransferError);
    const writer = sinkWriter.sink.getWriter();

    await writer.write(new Uint8Array([1, 2]));
    await writer.write(new Uint8Array([3]));
    await writer.close();

    expect(sinkWriter.toBlob('application/test').size).toBe(3);

    sinkWriter.clear();
    expect(sinkWriter.toBlob('application/test').size).toBe(0);
  });

  it('throws transfer-coded error when memory limit is exceeded', async () => {
    const sinkWriter = createInMemorySinkWriter(2, createTransferError);
    const writer = sinkWriter.sink.getWriter();

    await expect(writer.write(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({
      code: 'LIMIT_MEMORY_DOWNLOAD',
    });
  });
});

function createTransferError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}
