import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { __resolveEmulatorHostForTests } from '../../config/firebase';

interface GlobalWithWindow {
  window?: typeof window;
}

const getWindowStub = (): typeof window => {
  const stub = (globalThis as GlobalWithWindow).window;
  if (!stub) {
    throw new Error('Window stub not initialised');
  }
  return stub;
};

describe('resolveEmulatorHost', () => {
  let originalWindow: typeof window | undefined;

  beforeAll(() => {
    originalWindow = (globalThis as GlobalWithWindow).window;
  });

  beforeEach(() => {
    // Provide a minimal window stub for environments without DOM globals.
    (globalThis as GlobalWithWindow).window = {
      location: {
        hostname: 'localhost',
      },
    } as typeof window;
  });

  afterEach(() => {
    const stub = (globalThis as GlobalWithWindow).window;
    if (stub) {
      stub.location.hostname = 'localhost';
    }
  });

  afterAll(() => {
    if (originalWindow) {
      (globalThis as GlobalWithWindow).window = originalWindow;
    } else {
      delete (globalThis as GlobalWithWindow).window;
    }
  });

  it('accepts plain service names when running locally', () => {
    expect(__resolveEmulatorHostForTests('rtdb')).toBe('rtdb');
  });

  it('accepts service hostnames embedded in URLs when running locally', () => {
    expect(__resolveEmulatorHostForTests('http://firebase-emulator:9099')).toBe(
      'firebase-emulator',
    );
  });

  it('falls back to loopback when no candidate qualifies', () => {
    expect(__resolveEmulatorHostForTests('some host with spaces')).toBe('127.0.0.1');
  });

  it('uses page host when served from LAN address', () => {
    getWindowStub().location.hostname = '192.168.1.42';
    expect(__resolveEmulatorHostForTests(undefined)).toBe('192.168.1.42');
  });

  it('respects LAN IP candidate when running locally', () => {
    getWindowStub().location.hostname = 'localhost';
    expect(__resolveEmulatorHostForTests('192.168.1.50')).toBe('192.168.1.50');
  });
});
