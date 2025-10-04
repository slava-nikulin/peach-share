import { useNavigate } from '@solidjs/router';
import { type Component, onCleanup, onMount } from 'solid-js';
import { useNavActions } from '../components/nav-actions';
import { RoomModal, type RoomModalHandle } from '../components/RoomModal';
import { genSecret32, hkdfPathId, secretToBase64Url } from '../lib/crypto';

export const Home: Component = () => {
  const { setNavActions: setActions } = useNavActions();
  const navigate = useNavigate();

  const createRoom = async (): Promise<void> => {
    const secret = genSecret32();
    const pathId = await hkdfPathId(secret, 'path', 128);
    const secretB64 = secretToBase64Url(secret);
    navigate(`/room/${pathId}`, {
      state: { secret: secretB64, intent: 'create' },
    });
  };
  onMount(() => {
    setActions(
      <>
        <button
          type="button"
          onClick={handleJoinButtonClick}
          class="rounded-lg border border-slate-900/50 bg-white px-2 py-1.5 text-lg hover:cursor-pointer hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-900/10"
        >
          Join room
        </button>

        <button
          type="button"
          onClick={createRoom}
          class="rounded-lg bg-gradient-to-r from-pink-400 via-pink-500 to-pink-600 px-2 py-1.5 text-lg text-white shadow-sm hover:cursor-pointer hover:opacity-90 focus:outline-none focus:ring-4 focus:ring-slate-900/20"
        >
          Start sharing
        </button>
      </>,
    );
  });
  onCleanup(() => setActions(null));

  let joinRoomModal: RoomModalHandle | undefined;

  const handleJoinRoomForm = (roomCode: string): void => {
    console.log('Join room:', roomCode);
  };

  const handleJoinButtonClick = (): void => {
    joinRoomModal?.show();
  };

  const handleModalReady = (api: RoomModalHandle): void => {
    joinRoomModal = api;
  };

  return (
    <div class="grid grid-cols-1">
      <section class="mx-auto">
        <div class="mb-8 rounded-2xl border border-white/70 bg-white/60 p-5 shadow-sm">
          <h2 class="mb-2 font-semibold text-xl">Instructions</h2>
          <ol class="max-w-md list-inside list-decimal space-y-1 text-gray-500 text-md dark:text-slate-700">
            <li>Connect devices to the same Wi-Fi network.</li>
            <li>Create a room on one device.</li>
            <li>Connect from another device using the code/QR code.</li>
            <li>File sharing — in the next step.</li>
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
