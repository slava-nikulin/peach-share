import { useNavigate } from '@solidjs/router';
import { type Component, type JSX, onCleanup, onMount, type Setter } from 'solid-js';
import { useNavActions } from '../components/nav-actions';
import { RoomModal, type RoomModalHandle } from '../components/RoomModal';
import { fromBase64Url, genSecret32, hkdfPathId, toBase64Url } from '../lib/crypto';

interface NavActionOptions {
  onJoinClick: () => void;
  onCreateClick: () => Promise<void> | void;
  showOfflineDownload: boolean;
}

export const createHomeNavActions = ({
  onJoinClick,
  onCreateClick,
  showOfflineDownload,
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

    {showOfflineDownload && (
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
  setActions: Setter<JSX.Element | null>;
};

export const useHomeNavActions = ({
  setActions,
  onJoinClick,
  onCreateClick,
  showOfflineDownload,
}: NavActionsDeps): void => {
  onMount(() => {
    setActions(
      createHomeNavActions({
        onJoinClick,
        onCreateClick,
        showOfflineDownload,
      }),
    );
  });
  onCleanup(() => setActions(null));
};

interface JoinHandlers {
  handleJoinRoomForm: (secretB64: string) => Promise<void>;
  handleJoinButtonClick: () => void;
  handleModalReady: (api: RoomModalHandle) => void;
}

const createJoinHandlers = (navigate: ReturnType<typeof useNavigate>): JoinHandlers => {
  let joinRoomModal: RoomModalHandle | undefined;

  const handleJoinRoomForm = async (secretB64: string): Promise<void> => {
    const secret = fromBase64Url(secretB64);
    const pathId = await hkdfPathId(secret, 'path', 128);

    navigate(`/room/${pathId}`, {
      state: { secret: secretB64, intent: 'join' },
    });
  };

  const handleJoinButtonClick = (): void => {
    joinRoomModal?.show();
  };

  const handleModalReady = (api: RoomModalHandle): void => {
    joinRoomModal = api;
  };

  return { handleJoinRoomForm, handleJoinButtonClick, handleModalReady };
};

export const Home: Component = () => {
  const { setNavActions: setActions } = useNavActions();
  const navigate = useNavigate();
  const isOfflineAndEmu =
    import.meta.env.VITE_USE_EMULATORS === 'true' && import.meta.env.VITE_OFFLINE_MODE === 'true';

  const createRoom = async (): Promise<void> => {
    const secret = genSecret32();
    const pathId = await hkdfPathId(secret, 'path', 128);
    const secretB64 = toBase64Url(secret);
    navigate(`/room/${pathId}`, {
      state: { secret: secretB64, intent: 'create' },
    });
  };
  const { handleJoinRoomForm, handleJoinButtonClick, handleModalReady } =
    createJoinHandlers(navigate);
  useHomeNavActions({
    setActions,
    onJoinClick: handleJoinButtonClick,
    onCreateClick: createRoom,
    showOfflineDownload: isOfflineAndEmu,
  });

  return (
    <div class="grid grid-cols-1">
      <section class="mx-auto">
        <div class="mb-8 rounded-2xl border border-white/70 bg-white/60 p-5 shadow-sm">
          <h2 class="mb-2 font-semibold text-xl">Instructions</h2>
          <ol class="max-w-md list-inside list-decimal space-y-1 text-gray-500 text-md dark:text-slate-700">
            <li>Create a room on one device.</li>
            <li>Connect from another device using the secret code.</li>
            <li>Share files</li>
            <li>Close tab when you done</li>
          </ol>
        </div>
      </section>
      <RoomModal
        modalId="join-room-modal"
        title="Join Room"
        onSubmitRoom={handleJoinRoomForm}
        onReady={handleModalReady}
        submitBtnClass="text-white bg-gradient-to-r from-gray-500 via-gray-600 to-gray-700 hover:from-gray-600 hover:via-gray-700 hover:to-gray-800 focus:ring-gray-300"
        submitBtnText="Join"
      />
    </div>
  );
};
