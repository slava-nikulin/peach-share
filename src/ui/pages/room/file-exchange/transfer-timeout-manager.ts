type TimeoutHandle = ReturnType<typeof setTimeout>;

export interface IncomingTimeoutState {
  timeoutMeta?: TimeoutHandle;
  timeoutIdle?: TimeoutHandle;
  timeoutHard?: TimeoutHandle;
}

export interface OutgoingTimeoutState {
  timeoutIdle?: TimeoutHandle;
  timeoutHard?: TimeoutHandle;
}

export interface TimeoutConfig {
  metaTimeoutMs: number;
  idleTimeoutMs: number;
  hardTimeoutMs: number | null;
}

export class TransferTimeoutManager {
  private readonly cfg: TimeoutConfig;

  constructor(cfg: TimeoutConfig) {
    this.cfg = cfg;
  }

  armIncomingMetaTimeout(state: IncomingTimeoutState, onTimeout: () => void): void {
    this.clearIncomingMetaTimeout(state);
    state.timeoutMeta = setTimeout(onTimeout, this.cfg.metaTimeoutMs);
  }

  armIncomingIdleTimeout(state: IncomingTimeoutState, onTimeout: () => void): void {
    this.clearIncomingIdleTimeout(state);
    state.timeoutIdle = setTimeout(onTimeout, this.cfg.idleTimeoutMs);
  }

  armIncomingHardTimeout(state: IncomingTimeoutState, onTimeout: () => void): void {
    if (this.cfg.hardTimeoutMs == null) {
      return;
    }

    this.clearIncomingHardTimeout(state);
    state.timeoutHard = setTimeout(onTimeout, this.cfg.hardTimeoutMs);
  }

  clearIncomingTimeouts(state: IncomingTimeoutState): void {
    this.clearIncomingMetaTimeout(state);
    this.clearIncomingIdleTimeout(state);
    this.clearIncomingHardTimeout(state);
  }

  clearIncomingMetaTimeout(state: IncomingTimeoutState): void {
    this.clearIncomingMetaTimeoutInternal(state);
  }

  armOutgoingIdleTimeout(state: OutgoingTimeoutState, onTimeout: () => void): void {
    this.clearOutgoingIdleTimeout(state);
    state.timeoutIdle = setTimeout(onTimeout, this.cfg.idleTimeoutMs);
  }

  armOutgoingHardTimeout(state: OutgoingTimeoutState, onTimeout: () => void): void {
    if (this.cfg.hardTimeoutMs == null) {
      return;
    }

    this.clearOutgoingHardTimeout(state);
    state.timeoutHard = setTimeout(onTimeout, this.cfg.hardTimeoutMs);
  }

  clearOutgoingTimeouts(state: OutgoingTimeoutState): void {
    this.clearOutgoingIdleTimeout(state);
    this.clearOutgoingHardTimeout(state);
  }

  private clearIncomingMetaTimeoutInternal(state: IncomingTimeoutState): void {
    if (!state.timeoutMeta) {
      return;
    }

    clearTimeout(state.timeoutMeta);
    state.timeoutMeta = undefined;
  }

  private clearIncomingIdleTimeout(state: IncomingTimeoutState): void {
    if (!state.timeoutIdle) {
      return;
    }

    clearTimeout(state.timeoutIdle);
    state.timeoutIdle = undefined;
  }

  private clearIncomingHardTimeout(state: IncomingTimeoutState): void {
    if (!state.timeoutHard) {
      return;
    }

    clearTimeout(state.timeoutHard);
    state.timeoutHard = undefined;
  }

  private clearOutgoingIdleTimeout(state: OutgoingTimeoutState): void {
    if (!state.timeoutIdle) {
      return;
    }

    clearTimeout(state.timeoutIdle);
    state.timeoutIdle = undefined;
  }

  private clearOutgoingHardTimeout(state: OutgoingTimeoutState): void {
    if (!state.timeoutHard) {
      return;
    }

    clearTimeout(state.timeoutHard);
    state.timeoutHard = undefined;
  }
}
