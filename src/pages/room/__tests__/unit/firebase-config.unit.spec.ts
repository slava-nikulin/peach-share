import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type ResolveEmulatorHostFn = typeof import('../../config/firebase').__resolveEmulatorHostForTests;

interface GlobalWithWindow {
  window?: typeof window;
  self?: typeof window;
}

const createWindowStub = (hostname: string): typeof window =>
  ({
    location: {
      hostname,
    },
  }) as unknown as typeof window;

const setWindowHost = (hostname: string): void => {
  const stub = createWindowStub(hostname);
  const globalRef = globalThis as GlobalWithWindow;
  globalRef.window = stub;
  globalRef.self = stub;
};

let resolveEmulatorHost: ResolveEmulatorHostFn;
let originalWindow: typeof window | undefined;
let originalSelf: typeof window | undefined;

const loadSubject = async (
  envOverrides: Record<string, string | undefined> = {},
  hostname: string = 'localhost',
): Promise<void> => {
  vi.resetModules();
  vi.unstubAllEnvs();
  setWindowHost(hostname);
  for (const [key, value] of Object.entries(envOverrides)) {
    if (typeof value !== 'undefined') {
      vi.stubEnv(key, value);
    }
  }
  ({ __resolveEmulatorHostForTests: resolveEmulatorHost } = await import('../../config/firebase'));
};

describe('resolveEmulatorHost', () => {
  beforeAll(() => {
    const globalRef = globalThis as GlobalWithWindow;
    originalWindow = globalRef.window;
    originalSelf = globalRef.self;
  });

  beforeEach(async () => {
    await loadSubject();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    setWindowHost('localhost');
  });

  afterAll(() => {
    const globalRef = globalThis as GlobalWithWindow;
    if (originalWindow) globalRef.window = originalWindow;
    else delete globalRef.window;
    if (originalSelf) globalRef.self = originalSelf;
    else delete globalRef.self;
    vi.unstubAllEnvs();
  });

  it('accepts plain service names when running locally', () => {
    expect(resolveEmulatorHost('rtdb')).toBe('rtdb');
  });

  it('accepts service hostnames embedded in URLs when running locally', () => {
    expect(resolveEmulatorHost('http://firebase-emulator:9099')).toBe('firebase-emulator');
  });

  it('falls back to loopback when no candidate qualifies', () => {
    expect(resolveEmulatorHost('some host with spaces')).toBe('127.0.0.1');
  });

  it('uses page host when served from LAN address', () => {
    setWindowHost('192.168.1.42');
    expect(resolveEmulatorHost(undefined)).toBe('192.168.1.42');
  });

  it('respects LAN IP candidate when running locally', () => {
    setWindowHost('localhost');
    expect(resolveEmulatorHost('192.168.1.50')).toBe('192.168.1.50');
  });

  it('returns page host when offline bundle is served over LAN', async () => {
    await loadSubject(
      {
        VITE_OFFLINE_MODE: 'true',
        VITE_USE_EMULATORS: 'true',
      },
      '192.168.1.42',
    );
    expect(resolveEmulatorHost('http://127.0.0.1:9000')).toBe('192.168.1.42');
  });

  it('keeps env host when offline bundle runs on localhost', async () => {
    await loadSubject(
      {
        VITE_OFFLINE_MODE: 'true',
        VITE_USE_EMULATORS: 'true',
      },
      'localhost',
    );
    expect(resolveEmulatorHost('http://firebase-emulator:9099')).toBe('firebase-emulator');
  });
});
