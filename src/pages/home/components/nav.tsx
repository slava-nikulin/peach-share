import { type JSX, onCleanup, onMount, type Setter } from 'solid-js';

interface NavActionOptions {
  onJoinClick: () => void;
  onCreateClick: () => Promise<void> | void;
}

export const createHomeNavActions = ({
  onJoinClick,
  onCreateClick,
}: NavActionOptions): JSX.Element => (
  <>
    <button
      type="button"
      onClick={onJoinClick}
      class="rounded-lg border border-slate-900/50 bg-white px-2 py-1.5 text-lg hover:cursor-pointer hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-900/10"
    >
      Join room
    </button>

    <button
      type="button"
      onClick={onCreateClick}
      class="rounded-lg bg-gradient-to-r from-pink-400 via-pink-500 to-pink-600 px-2 py-1.5 text-lg text-white shadow-sm hover:cursor-pointer hover:opacity-90 focus:outline-none focus:ring-4 focus:ring-slate-900/20"
    >
      Start sharing
    </button>

    {import.meta.env.VITE_USE_LOCAL_SECURED_CONTEXT === 'true' && (
      <a
        href="/ca/peachshare-rootCA.crt"
        download=""
        class="me-2 inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-teal-400 via-teal-500 to-lime-400 px-2 py-1.5 text-lg text-white shadow-sm hover:cursor-pointer hover:opacity-90 focus:outline-none focus:ring-4 focus:ring-slate-900/20"
      >
        Download Root CA
      </a>
    )}
  </>
);

type NavActionsDeps = NavActionOptions & {
  setNavActions: Setter<JSX.Element | null>;
};

export const useHomeNavActions = ({
  setNavActions,
  onJoinClick,
  onCreateClick,
}: NavActionsDeps): void => {
  onMount(() => {
    setNavActions(
      createHomeNavActions({
        onJoinClick,
        onCreateClick,
      }),
    );
  });
  onCleanup(() => setNavActions(null));
};
