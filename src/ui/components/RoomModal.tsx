/** biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: <> */

import { Modal } from 'flowbite';
import { createSignal, type JSX, onCleanup, onMount } from 'solid-js';

export type RoomModalHandle = {
  show: () => void;
  hide: () => void;
  toggle: () => void;
};

type OpenValue = 'clear' | 'random' | (() => string);

export function RoomModal(props: {
  modalId: string;
  submitBtnText: string;
  submitBtnClass?: string;
  title?: string;
  onSubmitRoom?: (code: string) => Promise<void> | void;
  openValue?: OpenValue;

  ref?: (h: RoomModalHandle) => void;
}): JSX.Element {
  let inputEl: HTMLInputElement | undefined;
  let modalEl: HTMLDivElement | undefined;

  const [raw, setRaw] = createSignal('');

  const format = (d: string) => (d.length <= 3 ? d : `${d.slice(0, 3)}-${d.slice(3, 6)}`);
  const normalizeDigits6 = (s: string) => s.replace(/\D/g, '').slice(0, 6);
  const random6 = () => String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');

  const applyOpenValue = (): void => {
    const ov = props.openValue;
    if (!ov) return;
    if (ov === 'clear') setRaw('');
    else if (ov === 'random') setRaw(random6());
    else setRaw(normalizeDigits6(ov()));
  };

  let modalApi: any;

  onMount(() => {
    if (!modalEl) return;

    modalApi = new Modal(modalEl, {
      onShow: () => {
        applyOpenValue();
        requestAnimationFrame(() => {
          inputEl?.focus();
          // inputEl?.select();
        });
      },
    });

    props.ref?.({
      show: () => modalApi.show(),
      hide: () => modalApi.hide(),
      toggle: () => modalApi.toggle(),
    });
  });

  onCleanup(() => {
    modalApi = undefined;
    props.ref?.({ show: () => {}, hide: () => {}, toggle: () => {} });
  });

  return (
    <div
      ref={(el) => {
        modalEl = el;
      }}
      id={props.modalId}
      tabindex="-1"
      aria-hidden="true"
      class="fixed top-0 right-0 left-0 z-50 hidden h-[calc(100%-1rem)] max-h-full w-full items-center justify-center overflow-y-auto overflow-x-hidden md:inset-0"
    >
      <div class="relative max-h-full w-full max-w-md p-4">
        <div class="relative rounded-lg border border-gray-600 bg-gray-50 shadow-lg">
          <div class="flex items-center justify-between rounded-t border-gray-200 border-b p-4 md:p-5">
            <h3 class="font-semibold text-gray-900 text-xl">{props.title ?? 'Join Room'}</h3>
          </div>

          <div class="p-4 md:p-5">
            <form
              class="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();

                const code = raw();
                if (code.length !== 6) return;

                await props.onSubmitRoom?.(code);

                modalApi?.hide();
              }}
            >
              <div class="flex flex-col items-start">
                <input
                  ref={(el) => {
                    inputEl = el;
                  }}
                  name="room-id"
                  type="text"
                  inputMode="numeric"
                  autocomplete="off"
                  placeholder="123-123"
                  required
                  minLength={7}
                  maxLength={7}
                  pattern="[0-9]{3}-[0-9]{3}"
                  class="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-lg"
                  value={format(raw())}
                  onBeforeInput={(e) => {
                    const ie = e as InputEvent;

                    if (ie.inputType?.startsWith('insert')) {
                      const data = ie.data ?? '';
                      if (/\D/.test(data)) ie.preventDefault();
                    }
                  }}
                  onInput={(e) => {
                    const digits = e.currentTarget.value.replace(/\D/g, '').slice(0, 6);
                    setRaw(digits);
                  }}
                />
                <p class="mt-1 text-gray-500 text-sm">Room number</p>
              </div>

              <div class="flex items-center justify-between border-gray-200 border-t pt-4">
                <button
                  type="submit"
                  class={` ${
                    props.submitBtnClass ?? ''
                  } rounded-lg px-5 py-2.5 text-center font-medium text-md shadow-lg transition-all duration-200 hover:cursor-pointer hover:shadow-xl focus:outline-none focus:ring-4`}
                >
                  {props.submitBtnText}
                </button>
                <button
                  type="button"
                  data-modal-hide={props.modalId}
                  class="rounded-lg border border-gray-200 bg-white px-5 py-2.5 font-medium text-gray-900 text-md transition-colors hover:cursor-pointer hover:bg-gray-100 hover:text-blue-700 focus:z-10 focus:outline-none focus:ring-4 focus:ring-gray-100"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
