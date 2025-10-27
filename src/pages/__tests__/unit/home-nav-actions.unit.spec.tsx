// @vitest-environment jsdom

import { createRoot, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';
import { createHomeNavActions, useHomeNavActions } from '../../Home';

vi.mock('@solidjs/router', () => ({
  useNavigate: () => () => undefined,
}));

const noop = (): void => undefined;

interface MountedActions {
  host: HTMLDivElement;
  dispose: () => void;
}

const mountActions = (actions: JSX.Element | null): MountedActions => {
  const host = document.createElement('div');
  if (!actions) {
    return { host, dispose: (): void => {} };
  }

  const dispose = render(() => actions, host);
  return { host, dispose };
};

describe('createHomeNavActions', () => {
  it('includes download link when offline mode is visible', () => {
    const { host, dispose } = mountActions(
      createHomeNavActions({
        onJoinClick: noop,
        onCreateClick: noop,
        showOfflineDownload: true,
      }),
    );

    expect(host.querySelector('a[href="/ca/rootCA.pem"]')).not.toBeNull();
    expect(host.textContent).toContain('Download Root CA');

    dispose();
  });

  it('omits download link when offline mode is hidden', () => {
    const { host, dispose } = mountActions(
      createHomeNavActions({
        onJoinClick: noop,
        onCreateClick: noop,
        showOfflineDownload: false,
      }),
    );

    expect(host.querySelector('a[href="/ca/rootCA.pem"]')).toBeNull();

    dispose();
  });
});

describe('useHomeNavActions', () => {
  it('registers and clears nav actions', async () => {
    const setActions = vi.fn();

    await new Promise<void>((resolve) => {
      createRoot((disposeRoot) => {
        useHomeNavActions({
          setActions,
          onJoinClick: noop,
          onCreateClick: noop,
          showOfflineDownload: true,
        });

        queueMicrotask(() => {
          const firstCall = setActions.mock.calls[0]?.[0] ?? null;
          const { host, dispose } = mountActions(firstCall);
          expect(host.querySelector('a[href="/ca/rootCA.pem"]')).not.toBeNull();
          dispose();

          disposeRoot();
          resolve();
        });
      });
    });

    expect(setActions.mock.calls[0]?.[0]).not.toBeNull();
    expect(setActions.mock.calls.at(-1)?.[0]).toBeNull();
  });
});
