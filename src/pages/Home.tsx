import { onMount } from 'solid-js'
import { initFlowbite } from 'flowbite'
import { useNavigate } from '@solidjs/router'
import type { JSX } from 'solid-js/jsx-runtime'

export default function Home() {
  onMount(() => {
    // initFlowbite()
  })

  let dialogRef!: HTMLDialogElement
  let openerBtn!: HTMLButtonElement
  let firstInput!: HTMLInputElement

  const openCreateRoomModal = () => {
    dialogRef.showModal()
    queueMicrotask(() => firstInput?.focus())
  }

  const closeCreateRoomModal = () => {
    dialogRef.close()
    openerBtn?.focus()
  }

  const defaultCode = String(Math.floor(Math.random() * 10000)).padStart(4, '0')

  const navigate = useNavigate()

  const onSubmitCreateRoom: JSX.EventHandler<HTMLFormElement, SubmitEvent> = (
    e
  ) => {
    e.preventDefault()
    const form = e.currentTarget
    if (!form.reportValidity()) return // нативная валидация
    const code = (form.elements.namedItem('room-code') as HTMLInputElement)
      .value

    // выполнить свой код (например, запрос/логика)
    // ...

    navigate(`/rooms/${code}`) // переход на новый роут
  }

  return (
    <section class="mx-auto max-w-xl space-y-6">
      {/* Instructions */}
      <div class="rounded-2xl border border-white/70 bg-white/60 p-5 shadow-sm mb-8">
        <h2 class="text-xl font-semibold mb-2">Instructions</h2>
        <ol class="list-decimal ml-5 space-y-1 text-xl text-slate-700">
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
          ref={(el) => (openerBtn = el)}
          type="button"
          onClick={openCreateRoomModal}
          aria-haspopup="dialog"
          aria-controls="create-room-modal"
          class="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-pink-400 via-pink-500 to-pink-600 text-white px-5 py-2.5 text-lg
               shadow-sm hover:opacity-90 focus:outline-none focus:ring-4 focus:ring-slate-900/20 hover:cursor-pointer"
        >
          Create room
        </button>

        {/* Join */}
        <button
          type="button"
          data-modal-target="join-room-modal"
          data-modal-toggle="join-room-modal"
          aria-label="Join room"
          class="inline-flex items-center justify-center rounded-xl border border-slate-900/10 bg-white px-5 py-2.5 text-lg
               hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-900/10 hover:cursor-pointer"
        >
          Join room
        </button>
      </div>

      {/* --- Modal: Создать комнату --- */}
      <div
        id="create-room-modal"
        tabindex="-1"
        aria-hidden="true"
        class="hidden overflow-y-auto overflow-x-hidden fixed top-0 right-0 left-0 z-50 justify-center items-center w-full md:inset-0 h-[calc(100%-1rem)] max-h-full"
      >
        <div class="relative p-4 w-full max-w-xs max-h-full">
          <div class="relative bg-white rounded-lg shadow-sm dark:bg-gray-700 overflow-hidden">
            <div class="p-5 md:p-6">
              <form class="space-y-4" onSubmit={onSubmitCreateRoom}>
                <div>
                  <label
                    for="room-code"
                    class="block mb-3 font-semibold text-lg text-gray-900 dark:text-white"
                  >
                    Room number(4 digits)
                  </label>
                  <input
                    id="room-code"
                    name="room-code"
                    type="text"
                    inputmode="numeric"
                    pattern="\d{4}"
                    maxlength="4"
                    class="w-full bg-gray-50 border border-gray-300 text-gray-900 text-lg rounded-lg
                 focus:outline-none focus:ring-0
                 invalid:border-red-500 user-invalid:border-red-500
                 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
                    placeholder="0000"
                    value={defaultCode}
                    required
                  />
                </div>

                {/* footer */}
                <div class="flex items-center justify-between gap-2 pt-2">
                  <button
                    type="button"
                    data-modal-hide="create-room-modal"
                    class="text-white bg-gradient-to-r from-purple-500 via-purple-600 to-purple-700 hover:opacity-90 focus:ring-4 focus:outline-none focus:ring-slate-900/20 font-medium rounded-lg text-lg px-5 py-2.5 text-center"
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    data-modal-hide="create-room-modal"
                    class="py-2 px-4 text-lg font-medium text-gray-900 bg-white rounded-lg border border-gray-200 hover:bg-gray-100 focus:outline-none focus:ring-4 focus:ring-gray-100"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>

      {/* --- Modal: присоединиться к комнате --- */}
      <div
        id="join-room-modal"
        tabindex="-1"
        aria-hidden="true"
        class="hidden overflow-y-auto overflow-x-hidden fixed top-0 right-0 left-0 z-50 justify-center items-center w-full md:inset-0 h-[calc(100%-1rem)] max-h-full"
      >
        <div class="relative p-4 w-full max-w-xs max-h-full">
          <div class="relative bg-white rounded-lg shadow-sm dark:bg-gray-700">
            <div class="p-5 md:p-6">
              <form class="space-y-4">
                <div>
                  <label
                    for="room-code"
                    class="block mb-3 font-semibold text-lg text-gray-900 dark:text-white"
                  >
                    Room number(4 digits)
                  </label>
                  <input
                    id="room-code"
                    name="room-code"
                    type="number"
                    inputMode="numeric"
                    pattern="\d{4}"
                    maxLength={4}
                    class="bg-gray-50 border border-gray-300 text-gray-900 text-lg rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                    placeholder="0000"
                    required
                  />
                </div>

                {/* footer */}
                <div class="flex items-center justify-between gap-2 pt-2">
                  <button
                    type="button"
                    data-modal-hide="create-room-modal"
                    class="text-white bg-slate-900 hover:opacity-90 focus:ring-4 focus:outline-none focus:ring-slate-900/20 font-medium rounded-lg text-lg px-5 py-2.5 text-center"
                  >
                    Join
                  </button>
                  <button
                    type="button"
                    data-modal-hide="create-room-modal"
                    class="py-2 px-4 text-lg font-medium text-gray-900 bg-white rounded-lg border border-gray-200 hover:bg-gray-100 focus:outline-none focus:ring-4 focus:ring-gray-100"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
