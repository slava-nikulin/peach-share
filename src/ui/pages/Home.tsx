/** biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: <explanation> */

import { useNavigate } from '@solidjs/router';
import { type Component, createSignal, Show } from 'solid-js';
import { getBll } from '../../app/bll';
import type { RoomInitial } from '../../bll/use-cases/init-room';
import type { RoomIntent } from '../../entity/room';

export const Home: Component = () => {
  const navigate = useNavigate();

  const [raw, setRaw] = createSignal(''); // 6 digits
  const [busy, setBusy] = createSignal(false);
  const [modalOpen, setModalOpen] = createSignal(false);
  const [modalKind, setModalKind] = createSignal<RoomIntent>('create');
  const [pendingRoom, setPendingRoom] = createSignal<RoomInitial | null>(null);

  const format = (d: string) => (d.length <= 3 ? d : `${d.slice(0, 3)}-${d.slice(3, 6)}`);
  const random6 = () => String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
  const copyCode = async () => {
    const code = raw();
    if (code.length !== 6) return;
    await navigator.clipboard.writeText(code);
  };

  const openConfirm = (room: RoomInitial) => {
    setPendingRoom(room);
    setModalKind(room.intent);
    setModalOpen(true);
  };

  return (
    <div class="mx-auto grid w-full max-w-[min(92vw,1100px)] grid-cols-1 gap-6 lg:grid-cols-[1.2fr_0.8fr]">
      {/* Main card */}
      <section class="order-1">
        <div class="rounded-2xl border border-white/70 bg-white/70 p-6 shadow-sm backdrop-blur">
          <h1 class="mb-1 font-semibold text-2xl tracking-tight">Start share</h1>
          <p class="mb-5 text-gray-600 text-sm">
            Enter a 6‑digit room code or generate one, then start.
          </p>

          <form
            class="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();

              const code = raw();
              if (code.length !== 6) return;

              setBusy(true);
              try {
                const bll = await getBll();
                const room = await bll.initRoom.run(code);
                openConfirm(room);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label class="block">
              <span class="mb-2 block font-medium text-gray-700 text-sm">Room code</span>

              {/* Input + buttons group (Flowbite-style) */}
              <div class="flex w-full">
                <input
                  name="room-id"
                  type="text"
                  inputMode="numeric"
                  autocomplete="off"
                  placeholder="123-456"
                  required
                  minLength={7}
                  maxLength={7}
                  pattern="[0-9]{3}-[0-9]{3}"
                  class="w-full rounded-l-lg border border-gray-300 bg-gray-50 px-3 py-2 text-gray-900 text-lg tracking-widest focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
                  value={format(raw())}
                  onBeforeInput={(e) => {
                    const ie = e as InputEvent;
                    if (ie.inputType === 'insertText') {
                      const data = ie.data ?? '';
                      // Ограничиваем только ручной ввод; вставка обрабатывается в onInput.
                      if (/\D/.test(data)) ie.preventDefault();
                    }
                  }}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    const digits = el.value.replace(/\D/g, '').slice(0, 6);
                    setRaw(digits);
                    el.value = format(digits);
                  }}
                />

                <button
                  type="button"
                  class="inline-flex items-center justify-center gap-2 border border-gray-300 border-l-0 bg-white px-3 py-2 text-gray-700 hover:bg-gray-50 focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-200"
                  title="Generate random code"
                  onClick={() => setRaw(random6())}
                  disabled={busy()}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    width="24"
                    height="24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <title>Generate random code</title>
                    <path d="M20 12a8 8 0 1 1-6.34-7.66" />
                    <path d="M13 1.5l3 3-3 3" />
                  </svg>
                </button>

                <button
                  type="button"
                  class="inline-flex items-center justify-center border border-gray-300 border-l-0 bg-white px-3 py-2 text-gray-700 hover:bg-gray-50 focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-200"
                  title="Copy code"
                  onClick={() => void copyCode()}
                  disabled={busy() || raw().length !== 6}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    width="24"
                    height="24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <title>Copy code</title>
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                </button>

                <button
                  type="button"
                  class="inline-flex items-center justify-center rounded-r-lg border border-gray-300 border-l-0 bg-white px-3 py-2 text-gray-700 hover:bg-gray-50 focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-200"
                  title="Clear"
                  onClick={() => setRaw('')}
                  disabled={busy()}
                >
                  <svg viewBox="0 0 20 20" class="h-5 w-5" fill="currentColor" aria-hidden="true">
                    <path d="M6 6a1 1 0 011.41 0L10 8.59 12.59 6A1 1 0 1114 7.41L11.41 10 14 12.59A1 1 0 1112.59 14L10 11.41 7.41 14A1 1 0 016 12.59L8.59 10 6 7.41A1 1 0 016 6z" />
                  </svg>
                </button>
              </div>

              <p class="mt-2 text-gray-500 text-xs">
                Share the code with your peer. Codes are formatted as{' '}
                <span class="font-mono">xxx-xxx</span>.
              </p>
            </label>

            <button
              type="submit"
              disabled={busy() || raw().length !== 6}
              class="w-full rounded-lg bg-gradient-to-r from-gray-600 via-gray-700 to-gray-800 px-5 py-2.5 text-center font-medium text-white shadow-sm transition hover:shadow focus:outline-none focus:ring-4 focus:ring-gray-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy() ? 'Checking…' : 'Start'}
            </button>
          </form>
        </div>
      </section>

      {/* Secondary instructions */}
      <section class="order-2">
        <div class="rounded-2xl border border-white/70 bg-white/60 p-5 shadow-sm">
          <h2 class="mb-2 font-semibold text-gray-900 text-lg">Instructions</h2>
          <ol class="list-inside list-decimal space-y-1 text-gray-600 text-sm">
            <li>Enter or generate a room code.</li>
            <li>Press Start and confirm create/join.</li>
            <li>Share the link/code with the other side.</li>
          </ol>
        </div>
      </section>

      {/* Confirm modal (Flowbite-style markup) */}
      <Show when={modalOpen()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center">
          <div
            class="absolute inset-0 bg-gray-900/50"
            onClick={() => {
              setModalOpen(false);
              setPendingRoom(null);
            }}
          />
          <div class="relative z-10 w-[min(92vw,420px)] rounded-2xl bg-white p-6 shadow-lg">
            <h3 class="mb-2 font-semibold text-gray-900 text-lg">
              <Show when={modalKind() === 'create'} fallback={<>Join room?</>}>
                Create room?
              </Show>
            </h3>

            <p class="mb-5 text-gray-600 text-sm">
              <Show
                when={modalKind() === 'create'}
                fallback={
                  <>
                    Room <span class="font-mono">{format(raw())}</span> exists. You will join it.
                  </>
                }
              >
                Room <span class="font-mono">{format(raw())}</span> was not found. Create it and
                become initiator?
              </Show>
            </p>

            <div class="flex items-center justify-end gap-2">
              <button
                type="button"
                class="rounded-lg border border-gray-200 bg-white px-4 py-2 font-medium text-gray-900 text-sm hover:bg-gray-50 focus:outline-none focus:ring-4 focus:ring-gray-100"
                onClick={() => {
                  setModalOpen(false);
                  setPendingRoom(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                class="rounded-lg bg-gray-900 px-4 py-2 font-medium text-sm text-white hover:bg-gray-800 focus:outline-none focus:ring-4 focus:ring-gray-300"
                onClick={() => {
                  const room = pendingRoom();
                  if (!room) return;

                  setModalOpen(false);
                  setPendingRoom(null);
                  const nonce =
                    globalThis.crypto?.randomUUID?.() ??
                    `n_${Math.random().toString(16).slice(2)}_${Date.now()}`;

                  navigate(`/room/${raw()}`, {
                    state: {
                      start: true,
                      intent: room.intent,
                      roomId: room.roomId,
                      nonce,
                    },
                  });
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};
