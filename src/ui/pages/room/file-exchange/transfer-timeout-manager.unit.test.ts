import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type IncomingTimeoutState,
  type OutgoingTimeoutState,
  TransferTimeoutManager,
} from './transfer-timeout-manager';

describe('transfer timeout manager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('arms incoming meta timeout and clears it explicitly', () => {
    const manager = new TransferTimeoutManager({
      metaTimeoutMs: 10,
      idleTimeoutMs: 20,
      hardTimeoutMs: 30,
    });
    const state: IncomingTimeoutState = {};
    const onTimeout = vi.fn();

    manager.armIncomingMetaTimeout(state, onTimeout);
    vi.advanceTimersByTime(9);
    expect(onTimeout).not.toHaveBeenCalled();

    manager.clearIncomingMetaTimeout(state);
    vi.advanceTimersByTime(50);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('re-arms outgoing idle timeout and only keeps the latest timer', () => {
    const manager = new TransferTimeoutManager({
      metaTimeoutMs: 10,
      idleTimeoutMs: 20,
      hardTimeoutMs: 30,
    });
    const state: OutgoingTimeoutState = {};
    const onTimeout = vi.fn();

    manager.armOutgoingIdleTimeout(state, onTimeout);
    vi.advanceTimersByTime(10);
    manager.armOutgoingIdleTimeout(state, onTimeout);
    vi.advanceTimersByTime(10);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('does not arm hard timeout when disabled', () => {
    const manager = new TransferTimeoutManager({
      metaTimeoutMs: 10,
      idleTimeoutMs: 20,
      hardTimeoutMs: null,
    });
    const incoming: IncomingTimeoutState = {};
    const outgoing: OutgoingTimeoutState = {};
    const incomingTimeout = vi.fn();
    const outgoingTimeout = vi.fn();

    manager.armIncomingHardTimeout(incoming, incomingTimeout);
    manager.armOutgoingHardTimeout(outgoing, outgoingTimeout);
    vi.advanceTimersByTime(1_000);

    expect(incomingTimeout).not.toHaveBeenCalled();
    expect(outgoingTimeout).not.toHaveBeenCalled();
  });
});
