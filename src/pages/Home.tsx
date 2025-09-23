import { onMount } from 'solid-js'
import { initFlowbite } from 'flowbite'

export default function Home() {
  onMount(() => {
    initFlowbite()
  })

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
          type="button"
          data-modal-target="create-room-modal"
          data-modal-toggle="create-room-modal"
          aria-label="Create room"
          class="inline-flex items-center justify-center rounded-xl bg-slate-900 text-white px-5 py-2.5 text-lg
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
          class="inline-flex items-center justify-center rounded-xl border border-slate-900/10 bg-gray-100 px-5 py-2.5 text-lg
               hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-900/10 hover:cursor-pointer"
        >
          Join room
        </button>
      </div>

      {/* --- Modal: Создать комнату --- */}
      <div
        id="create-room-modal"
        tabIndex={-1}
        aria-hidden="true"
        class="hidden overflow-y-auto overflow-x-hidden fixed top-0 right-0 left-0 z-50 justify-center items-center w-full md:inset-0 h-[calc(100%-1rem)] max-h-full"
      >
        <div class="relative p-4 w-full max-w-lg max-h-full">
          <div class="relative bg-white rounded-2xl shadow-sm border border-gray-200">
            <div class="flex items-center justify-between p-4 md:p-5 border-b border-gray-200 rounded-t">
              <h3 class="text-base md:text-lg font-semibold text-gray-900">
                Создать комнату
              </h3>
              <button
                type="button"
                data-modal-hide="create-room-modal"
                class="text-gray-400 bg-transparent hover:bg-gray-100 hover:text-gray-900 rounded-lg text-sm w-8 h-8 inline-flex justify-center items-center"
              >
                <span class="sr-only">Закрыть</span>✕
              </button>
            </div>
            <div class="p-4 md:p-5 space-y-4">
              <label class="block text-sm font-medium">
                Название (опционально)
              </label>
              <input
                class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-4 focus:ring-orange-200"
                placeholder="Например: 'Кухня' или 'Команда-А'"
              />
              <div class="flex items-center gap-2 pt-2">
                <input
                  id="ttl"
                  type="checkbox"
                  class="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                />
                <label for="ttl" class="text-sm">
                  Удалять комнату, если пусто 2 минуты
                </label>
              </div>
            </div>
            <div class="flex items-center justify-end gap-2 p-4 md:p-5 border-t border-gray-200 rounded-b">
              <button
                data-modal-hide="create-room-modal"
                type="button"
                class="py-2 px-4 text-sm font-medium text-gray-900 bg-white rounded-lg border border-gray-200 hover:bg-gray-100 focus:outline-none focus:ring-4 focus:ring-gray-100"
              >
                Отмена
              </button>
              <button
                data-modal-hide="create-room-modal"
                type="button"
                class="text-white bg-slate-900 hover:opacity-90 focus:ring-4 focus:outline-none focus:ring-slate-900/20 font-medium rounded-lg text-sm px-5 py-2.5 text-center"
              >
                Создать
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* --- Modal: Подключиться к комнате --- */}
      <div
        id="join-room-modal"
        tabIndex={-1}
        aria-hidden="true"
        class="hidden overflow-y-auto overflow-x-hidden fixed top-0 right-0 left-0 z-50 justify-center items-center w-full md:inset-0 h-[calc(100%-1rem)] max-h-full"
      >
        <div class="relative p-4 w-full max-w-lg max-h-full">
          <div class="relative bg-white rounded-2xl shadow-sm border border-gray-200">
            <div class="flex items-center justify-between p-4 md:p-5 border-b border-gray-200 rounded-t">
              <h3 class="text-base md:text-lg font-semibold text-gray-900">
                Подключиться к комнате
              </h3>
              <button
                type="button"
                data-modal-hide="join-room-modal"
                class="text-gray-400 bg-transparent hover:bg-gray-100 hover:text-gray-900 rounded-lg text-sm w-8 h-8 inline-flex justify-center items-center"
              >
                <span class="sr-only">Закрыть</span>✕
              </button>
            </div>
            <div class="p-4 md:p-5 space-y-4">
              <label class="block text-sm font-medium">Код комнаты</label>
              <input
                class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm tracking-widest uppercase focus:outline-none focus:ring-4 focus:ring-orange-200"
                placeholder="Например: 7F2K-Q8"
              />
              <p class="text-xs text-slate-500">
                Советуем находиться в одном Wi-Fi для лучшего P2P.
              </p>
            </div>
            <div class="flex items-center justify-end gap-2 p-4 md:p-5 border-t border-gray-200 rounded-b">
              <button
                data-modal-hide="join-room-modal"
                type="button"
                class="py-2 px-4 text-sm font-medium text-gray-900 bg-white rounded-lg border border-gray-200 hover:bg-gray-100 focus:outline-none focus:ring-4 focus:ring-gray-100"
              >
                Отмена
              </button>
              <button
                data-modal-hide="join-room-modal"
                type="button"
                class="text-slate-900 bg-white border border-slate-200 hover:bg-slate-50 focus:ring-4 focus:outline-none focus:ring-slate-900/10 font-medium rounded-lg text-sm px-5 py-2.5 text-center"
              >
                Подключиться
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
