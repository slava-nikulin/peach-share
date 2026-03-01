import { describe, expect, it } from 'vitest';
import { HASH_MODE_SHA256_END, isControlMsg, PROTOCOL_ID } from './protocol';

describe('protocol validation', () => {
  it('accepts valid inventory snapshot and file meta messages', () => {
    const snapshot = {
      p: PROTOCOL_ID,
      t: 'INVENTORY_SNAPSHOT',
      files: [{ id: 'f1', name: 'a.txt', size: 10, mime: 'text/plain' }],
    };

    const meta = {
      p: PROTOCOL_ID,
      t: 'FILE_META',
      transferId: 't1',
      file: {
        id: 'f1',
        name: 'a.txt',
        size: 10,
        mime: 'text/plain',
        hash: { alg: 'sha256', value: 'abc' },
      },
    };

    const fileEnd = {
      p: PROTOCOL_ID,
      t: 'FILE_END',
      transferId: 't1',
      hash: {
        alg: 'sha256',
        value: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649bf427c2d43ce1f5e5a8a8',
      },
    };

    expect(isControlMsg(snapshot)).toBe(true);
    expect(isControlMsg(meta)).toBe(true);
    expect(isControlMsg(fileEnd)).toBe(true);
  });

  it('accepts HELLO with fx/2 capability negotiation payload', () => {
    const hello = {
      p: PROTOCOL_ID,
      t: 'HELLO',
      sessionId: 's1',
      appBuildId: 'dev-build',
      caps: {
        maxMessageBytes: 64 * 1024,
        chunkBytes: 32 * 1024,
        maxFileBytes: 1000 * 1024 * 1024,
        hash: {
          algorithms: ['sha256'],
          modes: [HASH_MODE_SHA256_END],
        },
        inventory: {
          versioning: true,
          paging: true,
        },
      },
    };

    expect(isControlMsg(hello)).toBe(true);
  });

  it('accepts valid fx/2 inventory versioning and paging messages', () => {
    const snapshot = {
      p: PROTOCOL_ID,
      t: 'INVENTORY_SNAPSHOT',
      inventoryVersion: 3,
      files: [{ id: 'f1', name: 'a.txt', size: 1, mime: 'text/plain' }],
    };

    const delta = {
      p: PROTOCOL_ID,
      t: 'INVENTORY_DELTA',
      baseVersion: 3,
      nextVersion: 4,
      add: [{ id: 'f2', name: 'b.txt', size: 2, mime: 'text/plain' }],
      remove: ['f1'],
    };

    const begin = {
      p: PROTOCOL_ID,
      t: 'INVENTORY_SNAPSHOT_BEGIN',
      snapshotId: 's1',
      inventoryVersion: 4,
      totalParts: 2,
    };

    const part = {
      p: PROTOCOL_ID,
      t: 'INVENTORY_SNAPSHOT_PART',
      snapshotId: 's1',
      partIndex: 0,
      files: [{ id: 'f2', name: 'b.txt', size: 2, mime: 'text/plain' }],
    };

    const end = {
      p: PROTOCOL_ID,
      t: 'INVENTORY_SNAPSHOT_END',
      snapshotId: 's1',
      inventoryVersion: 4,
      totalParts: 2,
    };

    const resync = {
      p: PROTOCOL_ID,
      t: 'INVENTORY_RESYNC_REQUEST',
      reason: 'delta_base_version_mismatch',
    };

    expect(isControlMsg(snapshot)).toBe(true);
    expect(isControlMsg(delta)).toBe(true);
    expect(isControlMsg(begin)).toBe(true);
    expect(isControlMsg(part)).toBe(true);
    expect(isControlMsg(end)).toBe(true);
    expect(isControlMsg(resync)).toBe(true);
  });

  it('rejects malformed messages and invalid hash algorithms', () => {
    const badSnapshot = {
      p: PROTOCOL_ID,
      t: 'INVENTORY_SNAPSHOT',
      files: [{ id: 'f1', name: 'a.txt', size: '10', mime: 'text/plain' }],
    };

    const badMeta = {
      p: PROTOCOL_ID,
      t: 'FILE_META',
      transferId: 't1',
      file: {
        id: 'f1',
        name: 'a.txt',
        size: 10,
        mime: 'text/plain',
        hash: { alg: 'sha1', value: 'abc' },
      },
    };

    const badHello = {
      p: PROTOCOL_ID,
      t: 'HELLO',
      sessionId: 's1',
      appBuildId: 'dev-build',
      caps: {
        maxMessageBytes: 64 * 1024,
        chunkBytes: 32 * 1024,
        maxFileBytes: 1000 * 1024 * 1024,
        hash: {
          algorithms: ['sha256'],
          modes: ['sha1-end'],
        },
        inventory: {
          versioning: true,
          paging: true,
        },
      },
    };

    const badDelta = {
      p: PROTOCOL_ID,
      t: 'INVENTORY_DELTA',
      baseVersion: 2,
      nextVersion: '3',
      add: [{ id: 'f2', name: 'b.txt', size: 2, mime: 'text/plain' }],
    };

    const badPaging = {
      p: PROTOCOL_ID,
      t: 'INVENTORY_SNAPSHOT_BEGIN',
      snapshotId: 's1',
      inventoryVersion: 4,
      totalParts: 0,
    };

    const badFileEnd = {
      p: PROTOCOL_ID,
      t: 'FILE_END',
      transferId: 't1',
      hash: {
        alg: 'sha1',
        value: 'abc',
      },
    };

    expect(isControlMsg(badSnapshot)).toBe(false);
    expect(isControlMsg(badMeta)).toBe(false);
    expect(isControlMsg(badHello)).toBe(false);
    expect(isControlMsg(badDelta)).toBe(false);
    expect(isControlMsg(badPaging)).toBe(false);
    expect(isControlMsg(badFileEnd)).toBe(false);
  });
});
