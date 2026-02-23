import { describe, expect, it } from 'vitest';
import { HASH_MODE_SHA256_END, PROTOCOL_ID, type HelloMsg } from './protocol';
import {
  buildLocalHelloCapabilities,
  createDefaultNegotiatedSessionSettings,
  negotiateSessionFromHello,
} from './session-negotiation';

const baseConfig = {
  transportMaxMessageBytes: 64 * 1024,
  fileChunkBytes: 8 * 1024,
  maxFileBytes: 512 * 1024 * 1024,
};

describe('session negotiation helpers', () => {
  it('creates fx/2 defaults', () => {
    const settings = createDefaultNegotiatedSessionSettings(baseConfig);
    expect(settings.protocol).toBe(PROTOCOL_ID);
    expect(settings.hashMode).toBe(HASH_MODE_SHA256_END);
    expect(settings.inventoryVersioning).toBe(true);
    expect(settings.inventoryPaging).toBe(true);
  });

  it('negotiates shared limits on matching build ids', () => {
    const localCaps = buildLocalHelloCapabilities(baseConfig);
    const hello: HelloMsg = {
      p: PROTOCOL_ID,
      t: 'HELLO',
      sessionId: 'peer',
      appBuildId: 'dev-build',
      caps: {
        maxMessageBytes: 32 * 1024,
        chunkBytes: 4 * 1024,
        maxFileBytes: 128 * 1024 * 1024,
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

    const result = negotiateSessionFromHello(localCaps, 'dev-build', hello);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.settings.protocol).toBe(PROTOCOL_ID);
    expect(result.settings.maxMessageBytes).toBe(32 * 1024);
    expect(result.settings.chunkBytes).toBe(4 * 1024);
    expect(result.settings.maxFileBytes).toBe(128 * 1024 * 1024);
  });

  it('fails with BUILD_MISMATCH when build ids differ', () => {
    const localCaps = buildLocalHelloCapabilities(baseConfig);
    const hello: HelloMsg = {
      p: PROTOCOL_ID,
      t: 'HELLO',
      sessionId: 'peer',
      appBuildId: 'build-peer',
      caps: buildLocalHelloCapabilities(baseConfig),
    };

    const result = negotiateSessionFromHello(localCaps, 'build-local', hello);
    expect(result).toMatchObject({
      ok: false,
      code: 'BUILD_MISMATCH',
    });
  });

  it('fails when peer omits required caps', () => {
    const localCaps = buildLocalHelloCapabilities(baseConfig);
    const hello: HelloMsg = {
      p: PROTOCOL_ID,
      t: 'HELLO',
      sessionId: 'peer',
      appBuildId: 'dev-build',
    };

    const result = negotiateSessionFromHello(localCaps, 'dev-build', hello);
    expect(result).toMatchObject({
      ok: false,
      code: 'NEGOTIATION_FAILED',
    });
  });
});
