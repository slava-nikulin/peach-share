// pages/Home.tsx
import { useNavigate } from '@solidjs/router';
import type { Component } from 'solid-js';
import { useNavActions } from '../components/nav-actions';
import { RoomModal } from '../components/RoomModal';
import { genSecret32, hkdfPathId, toBase64Url } from '../lib/crypto';
import { useHomeNavActions } from './home/components/nav';
import { createJoinHandlers } from './home/join';

export const Home: Component = () => {
  const { setNavActions } = useNavActions();
  const navigate = useNavigate();

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
    setNavActions,
    onJoinClick: async () => {
      void handleJoinButtonClick();
    },
    onCreateClick: createRoom,
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
