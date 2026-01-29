import type { TimerPort } from './ports';

export class RealTimer implements TimerPort {
  async wait(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    return new Promise<void>((resolve, reject) => {
      const id = setTimeout(() => {
        cleanup();
        resolve();
      }, ms);

      const onAbort = () => {
        clearTimeout(id);
        cleanup();
        reject(new DOMException('Aborted', 'AbortError'));
      };

      const cleanup = () => {
        signal.removeEventListener('abort', onAbort);
      };

      signal.addEventListener('abort', onAbort);
    });
  }

  now(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }
}
