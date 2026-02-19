/** biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: <explanation> */
import { useLocation, useParams } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { getBll } from '../../app/bll';
import type { RoomIntent } from '../../entity/room';
import { RoomErrorState } from '../components/room/RoomErrorState';

type RoomErrorKind = 'invalid_link' | 'expired_session' | 'operation_failed';
type View = 'error' | 'loading' | 'content';

type RoomNavState = {
  start: true;
  intent: RoomIntent;
  nonce: string;
};

const SS_PREFIX = 'room:visited:';

export function Room(): JSX.Element {
  const params = useParams<{ id: string }>();
  const location = useLocation<RoomNavState>();

  const [view, setView] = createSignal<View>('loading');
  const [errorText, setErrorText] = createSignal<string>('');
  const [errorTitle, setErrorTitle] = createSignal<string>('');

  const asMessage = (err: unknown): string => {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  };

  const showError = (kind: RoomErrorKind, err?: unknown) => {
    if (kind === 'invalid_link') {
      setErrorTitle('Invalid room link');
      setErrorText(
        'This room can only be opened from the Start page. Please generate or enter a code again.',
      );
      setView('error');
      return;
    }

    if (kind === 'expired_session') {
      setErrorTitle('Room session expired');
      setErrorText(
        "For security, this room page can't be reopened via browser history. Start a new session from the main page.",
      );
      setView('error');
      return;
    }

    // operation_failed
    setErrorTitle('Failed to start room');
    const details = err ? asMessage(err) : 'Unknown error';
    setErrorText(`The room could not be started. Details: ${details}`);
    setView('error');
  };

  const runGuard = (): { roomId: string; intent: RoomIntent } | null => {
    const roomId = params.id;
    const navState = location.state;

    const hasValidState =
      !!roomId &&
      !!navState &&
      navState.start === true &&
      typeof navState.intent === 'string' &&
      navState.intent.length > 0 &&
      typeof navState.nonce === 'string' &&
      navState.nonce.length > 0;

    if (!hasValidState) {
      showError('invalid_link');
      return null;
    }

    const storageKey = `${SS_PREFIX}${navState.nonce}`;

    // без try/catch: если sessionStorage бросит исключение — поймаем в onMount-обвязке
    if (sessionStorage.getItem(storageKey) === '1') {
      showError('expired_session');
      return null;
    }

    sessionStorage.setItem(storageKey, '1');

    return { roomId, intent: navState.intent };
  };

  const startRoomFlow = async (intent: RoomIntent, roomId: string): Promise<void> => {
    const bll = await getBll();
    if (intent === 'create') await bll.createRoom.run(roomId);
    else await bll.joinRoom.run(roomId);
  };

  onMount(() => {
    const runEntry = async () => {
      try {
        const ok = runGuard();
        if (!ok) return;

        setView('loading');
        await startRoomFlow(ok.intent, ok.roomId);
        setView('content');
      } catch (err) {
        showError('operation_failed', err);
      }
    };

    void runEntry();

    const onPop = () => queueMicrotask(() => void runEntry());
    window.addEventListener('popstate', onPop);

    onCleanup(() => window.removeEventListener('popstate', onPop));
  });

  return (
    <main class="mx-auto w-full max-w-5xl space-y-4 px-4 py-6">
      {/* 1) ERROR */}
      <Show when={view() === 'error'}>
        <RoomErrorState title={errorTitle()} message={errorText()} />
      </Show>

      {/* 2) SKELETON */}
      <Show when={view() === 'loading'}>
        <div class="animate-pulse space-y-4">
          <div class="h-6 w-1/3 rounded bg-gray-200" />
          <div class="h-4 w-2/3 rounded bg-gray-200" />
          <div class="h-48 rounded bg-gray-200" />
        </div>
      </Show>

      {/* 3) CONTENT */}
      <Show when={view() === 'content'}>
        <div
          class="relative space-y-4"
          role="application"
          aria-label="File sharing workspace"
          tabIndex={-1}
        >
          {/* Drop overlay (пока статически скрыт; динамику добавим позже) */}
          <div
            data-testid="room-drop-overlay"
            class="pointer-events-none fixed inset-0 z-50 hidden items-center justify-center bg-slate-900/55 backdrop-blur-sm transition-opacity duration-150"
          >
            <div class="pointer-events-none rounded-3xl border border-white/40 bg-white/95 px-10 py-8 text-center shadow-2xl shadow-slate-900/20">
              <p class="font-semibold text-slate-900 text-xl">Drop files to share</p>
              <p class="mt-2 text-slate-600 text-sm">Transfers stay private and peer-to-peer.</p>
            </div>
          </div>

          <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* Dropzone (только верстка) */}
            <div class="rounded-2xl border border-white/70 bg-white/70 p-4 shadow-sm">
              <label
                data-testid="room-dropzone"
                class="flex h-44 w-full flex-col items-center justify-center rounded-xl border-2 border-gray-300 border-dashed bg-gray-50 hover:cursor-pointer hover:bg-gray-100 md:h-56"
              >
                <div class="flex flex-col items-center justify-center pt-5 pb-6 text-center">
                  <svg
                    class="mb-2 h-7 w-7 text-gray-500"
                    viewBox="0 0 20 16"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      stroke="currentColor"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6m0 0L8 8m2-2 2 2"
                    />
                  </svg>
                  <p class="text-gray-600 text-sm">
                    <span class="font-medium">Click</span> to upload
                  </p>
                  <p class="text-gray-500 text-xs">Or drag files here</p>
                </div>

                <input type="file" data-testid="room-file-input" class="hidden" multiple />
              </label>
            </div>

            {/* You */}
            <div class="flex flex-col rounded-2xl border border-white/70 bg-white/70 shadow-sm md:col-span-2">
              <div class="flex items-center justify-between border-gray-200 border-b px-4 py-2">
                <div class="flex min-w-0 items-center gap-2">
                  <span class="h-2.5 w-2.5 shrink-0 rounded-full border border-white bg-emerald-500" />
                  <span class="truncate font-medium text-sm">You (you)</span>
                </div>
                <span class="rounded-full border border-orange-200 bg-orange-100 px-2 py-0.5 text-[11px] text-orange-800">
                  0
                </span>
              </div>

              <div class="p-2">
                <div class="max-h-56 space-y-1.5 overflow-y-auto">
                  <div class="rounded-lg border border-gray-300 border-dashed bg-gray-50 px-3 py-6 text-center text-slate-500 text-sm">
                    No files
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Guest */}
          <div class="flex flex-col rounded-2xl border border-white/70 bg-white/70 shadow-sm">
            <div class="flex items-center justify-between border-gray-200 border-b px-4 py-2">
              <div class="flex min-w-0 items-center gap-2">
                <span class="h-2.5 w-2.5 shrink-0 rounded-full border border-white bg-sky-500" />
                <span class="truncate font-medium text-sm">Guest</span>
              </div>
              <span class="rounded-full border border-orange-200 bg-orange-100 px-2 py-0.5 text-[11px] text-orange-800">
                0
              </span>
            </div>

            <div class="p-2">
              <div class="max-h-56 space-y-1.5 overflow-y-auto">
                <div class="rounded-lg border border-gray-300 border-dashed bg-gray-50 px-3 py-6 text-center text-slate-500 text-sm">
                  No files
                </div>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </main>
  );
}
