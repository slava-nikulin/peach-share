import type FakeTimers from '@sinonjs/fake-timers';
import type { TimerPort } from '../../lib/ports';

export class FakeTimer implements TimerPort {
  private readonly clock: FakeTimers.InstalledClock;

  constructor(clock: FakeTimers.InstalledClock) {
    this.clock = clock;
  }

  wait(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    }

    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        this.clock.clearTimeout(timeoutId);
        signal.removeEventListener('abort', onAbort);
        reject(new DOMException('Aborted', 'AbortError'));
      };

      const timeoutId = this.clock.setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);

      signal.addEventListener('abort', onAbort);
    });
  }

  now(): number {
    // clock.now — число миллисекунд с "начала" фейкового времени
    return this.clock.now;
  }
}
