import { useNavigate } from '@solidjs/router';
import { createSignal, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { RoomModal, type RoomModalHandle } from '../RoomModal';

export function HomeNavBar(): JSX.Element {
  // const [createRoomModal, setCreateRoomModal] = createSignal<RoomModalHandle>();
  // const [joinRoomModal, setJoinRoomModal] = createSignal<RoomModalHandle>();
  // const navigate = useNavigate();

  return (
    <>
      {/* <button
        type="button"
        onClick={() => joinRoomModal()?.show()}
        class="rounded-lg border border-slate-900/50 bg-white px-2 py-1.5 text-lg hover:cursor-pointer hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-900/10"
      >
        Join room
      </button>

      <button
        type="button"
        onClick={() => createRoomModal()?.show()}
        class="rounded-lg bg-gradient-to-r from-pink-400 via-pink-500 to-pink-600 px-2 py-1.5 text-lg text-white shadow-sm hover:cursor-pointer hover:opacity-90 focus:outline-none focus:ring-4 focus:ring-slate-900/20"
      >
        Start sharing
      </button>

      <Portal mount={document.body}>
        <RoomModal
          modalId="join-room-modal"
          submitBtnClass="text-white bg-gradient-to-r from-gray-500 via-gray-600 to-gray-700 hover:from-gray-600 hover:via-gray-700 hover:to-gray-800 focus:ring-gray-300"
          submitBtnText="Join"
          title="Join Room"
          onSubmitRoom={(code) => {
            navigate(`/room/${code}`);
          }}
          openValue="clear"
          ref={(h) => setJoinRoomModal(() => h)}
        />
      </Portal> */}

      {/* <Portal mount={document.body}>
        <RoomModal
          modalId="create-room-modal"
          submitBtnClass="text-white bg-gradient-to-r from-gray-500 via-gray-600 to-gray-700 hover:from-gray-600 hover:via-gray-700 hover:to-gray-800 focus:ring-gray-300"
          submitBtnText="Create"
          title="Create Room"
          onSubmitRoom={() => alert('create!')}
          openValue="random"
          ref={(h) => setCreateRoomModal(() => h)}
        />
      </Portal> */}

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
}
