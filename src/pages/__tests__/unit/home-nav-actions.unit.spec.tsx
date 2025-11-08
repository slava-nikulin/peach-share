// @vitest-environment jsdom

import { createRoot, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHomeNavActions, useHomeNavActions } from '../../home/components/nav';

vi.mock('@solidjs/router', () => ({
  useNavigate: () => () => undefined,
}));

const noop = (): void => undefined;

interface MountedActions {
  host: HTMLDivElement;
  dispose: () => void;
}

type ActionInput = JSX.Element | null | (() => JSX.Element | null);

const mountActions = (actions: ActionInput): MountedActions => {
  const host = document.createElement('div');
  if (typeof actions !== 'function' && !actions) {
    return { host, dispose: (): void => {} };
  }

  const factory =
    typeof actions === 'function'
      ? (actions as () => JSX.Element | null)
      : (): JSX.Element | null => actions;
  const dispose = render(factory, host);
  return { host, dispose };
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createHomeNavActions', () => {
  it('includes download link when offline mode is visible', () => {
    vi.stubEnv('VITE_USE_LOCAL_SECURED_CONTEXT', 'true');
    const { host, dispose } = mountActions(() =>
      createHomeNavActions({
        onJoinClick: noop,
        onCreateClick: noop,
      }),
    );

    expect(host.querySelector('a[href="/ca/peachshare-rootCA.crt"]')).not.toBeNull();
    expect(host.textContent).toContain('Download Root CA');

    dispose();
  });

  it('omits download link when offline mode is hidden', () => {
    vi.stubEnv('VITE_USE_LOCAL_SECURED_CONTEXT', 'false');
    const { host, dispose } = mountActions(() =>
      createHomeNavActions({
        onJoinClick: noop,
        onCreateClick: noop,
      }),
    );

    expect(host.querySelector('a[href="/ca/peachshare-rootCA.crt"]')).toBeNull();

    dispose();
  });
});

describe('useHomeNavActions', () => {
  it('registers and clears nav actions', async () => {
    const setActions = vi.fn();

    await new Promise<void>((resolve) => {
      createRoot((disposeRoot) => {
        vi.stubEnv('VITE_USE_LOCAL_SECURED_CONTEXT', 'true');
        useHomeNavActions({
          setNavActions: setActions,
          onJoinClick: noop,
          onCreateClick: noop,
        });

        queueMicrotask(() => {
          const firstCall = setActions.mock.calls[0]?.[0] ?? null;
          const { host, dispose } = mountActions(firstCall);
          expect(host.querySelector('a[href="/ca/peachshare-rootCA.crt"]')).not.toBeNull();
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
