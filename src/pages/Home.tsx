import RoomModal, { type RoomModalHandle } from '../components/RoomModal'
import { createRoomSession } from '../lib/webrtc'

export default function Home() {
  let createRoomModal: RoomModalHandle | undefined

  const handleCreateRoomForm = (roomCode: string) => {
    console.log('Create room:', roomCode)
    // createRoomSession({
    //   roomId: roomCode,
    //   signalingUrl: SIGNALING_URL,
    //   iceServers: ICE_SERVERS,
    // })
  }

  let joinRoomModal: RoomModalHandle | undefined

  const handleJoinRoomForm = (roomCode: string) => {
    console.log('Join room:', roomCode)
  }

  return (
    <div class="grid grid-cols-1">
      <section class="mx-auto">
        {/* Instructions */}
        <div class="rounded-2xl border border-white/70 bg-white/60 p-5 shadow-sm mb-8">
          <h2 class="text-xl font-semibold mb-2">Instructions</h2>
          <ol class=" text-md max-w-md space-y-1 text-gray-500 list-decimal list-inside dark:text-slate-700">
            <li>Connect devices to the same Wi-Fi network.</li>
            <li>Create a room on one device.</li>
            <li>Connect from another device using the code/QR code.</li>
            <li>File sharing — in the next step.</li>
          </ol>
        </div>

        {/* Actions */}
        <div class="grid grid-rows-2 gap-y-5 justify-stretch items-center md:flex md:flex-row md:justify-around ">
          {/* Create */}
          <button
            type="button"
            onClick={() => createRoomModal?.show()}
            class="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-pink-400 via-pink-500 to-pink-600 text-white px-5 py-2.5 text-lg
               shadow-sm hover:opacity-90 focus:outline-none focus:ring-4 focus:ring-slate-900/20 hover:cursor-pointer"
          >
            Create room
          </button>

          {/* Join */}
          <button
            type="button"
            onClick={() => joinRoomModal?.show()}
            class="inline-flex items-center justify-center rounded-xl border border-slate-900/10 bg-white px-5 py-2.5 text-lg
               hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-900/10 hover:cursor-pointer"
          >
            Join room
          </button>
        </div>
      </section>
      <RoomModal
        modalId="create-room-modal"
        title="Create Room"
        fillWithDefault={true}
        onSubmitRoom={handleCreateRoomForm}
        onReady={(api) => (createRoomModal = api)}
        submitBtnClass="text-white bg-gradient-to-r from-purple-500 via-purple-600 to-purple-700 hover:from-purple-600 hover:via-purple-700 hover:to-purple-800 focus:ring-purple-300"
        submitBtnText="Create"
      />

      <RoomModal
        modalId="join-room-modal"
        title="Join Room"
        fillWithDefault={false}
        onSubmitRoom={handleJoinRoomForm}
        onReady={(api) => (joinRoomModal = api)}
        submitBtnClass="text-white bg-gradient-to-r from-gray-500 via-gray-600 to-gray-700 hover:from-gray-600 hover:via-gray-700 hover:to-gray-800 focus:ring-gray-300"
        submitBtnText="Join"
      />
    </div>
  )
}
