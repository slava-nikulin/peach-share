/** biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: todo refactor */
import { useLocation, useParams } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { getBll } from '../../app/bll';
import type { P2pChannel } from '../../bll/ports/p2p-channel';
import type { RoomIntent } from '../../entity/room';
import { RoomErrorState } from './room/components/RoomErrorState';
import { RoomWorkspace } from './room/components/RoomWorkspace';

type RoomErrorKind = 'invalid_link' | 'expired_session' | 'operation_failed';
type View = 'error' | 'loading' | 'content';

interface RoomNavState {
  start: true;
  intent: RoomIntent;
  roomId: string;
  nonce: string;
}

const SS_PREFIX = 'room:visited:';

export function Room(): JSX.Element {
  const params = useParams<{ id: string }>();
  const location = useLocation<RoomNavState>();

  const [view, setView] = createSignal<View>('loading');
  const [errorText, setErrorText] = createSignal<string>('');
  const [errorTitle, setErrorTitle] = createSignal<string>('');

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

  const asDebugJson = (value: unknown): string => {
    const seen = new WeakSet<object>();
    try {
      return JSON.stringify(
        value,
        (_key, currentValue) => {
          if (typeof currentValue === 'bigint') return `${currentValue}n`;

          if (typeof currentValue === 'object' && currentValue !== null) {
            if (seen.has(currentValue)) return '[Circular]';
            seen.add(currentValue);
          }

          return currentValue;
        },
        2,
      );
    } catch {
      return String(value);
    }
  };

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: todo refactor
  const buildOperationFailureText = (err: unknown): string => {
    const errorName = err instanceof Error ? err.name : typeof err;
    const errorMessage =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : isRecord(err) && typeof err.message === 'string'
            ? err.message
            : 'N/A';
    const errorCode = isRecord(err) && err.code !== undefined ? String(err.code) : 'N/A';
    const errorCause = isRecord(err) && err.cause !== undefined ? asDebugJson(err.cause) : 'N/A';
    const errorStack = err instanceof Error && err.stack ? err.stack : 'N/A';

    const context = {
      time: new Date().toISOString(),
      href: window.location.href,
      routeRoomId: params.id ?? null,
      navState: location.state ?? null,
      online: navigator.onLine,
      userAgent: navigator.userAgent,
    };

    return [
      'The room could not be started.',
      '',
      `Error name: ${errorName}`,
      `Error message: ${errorMessage}`,
      `Error code: ${errorCode}`,
      `Error cause: ${errorCause}`,
      '',
      'Stack:',
      errorStack,
      '',
      'Raw error:',
      asDebugJson(err),
      '',
      'Context:',
      asDebugJson(context),
    ].join('\n');
  };

  const showError = (kind: RoomErrorKind, err?: unknown): void => {
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
    setErrorText(buildOperationFailureText(err));
    setView('error');
  };

  const runGuard = (): { roomId: string; intent: RoomIntent } | null => {
    const routeRoomCode = params.id;
    const navState = location.state;

    const hasValidState =
      !!routeRoomCode &&
      !!navState &&
      navState.start === true &&
      typeof navState.intent === 'string' &&
      navState.intent.length > 0 &&
      typeof navState.roomId === 'string' &&
      navState.roomId.length > 0 &&
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

    return { roomId: navState.roomId, intent: navState.intent };
  };

  const [channel, setChannel] = createSignal<P2pChannel | null>(null);

  const startRoomFlow = async (intent: RoomIntent, roomId: string): Promise<P2pChannel> => {
    const bll = await getBll();
    return intent === 'create' ? await bll.createRoom.run(roomId) : await bll.joinRoom.run(roomId);
  };

  onMount(() => {
    let runVersion = 0;

    const runEntry = (): void => {
      const currentRun = ++runVersion;

      try {
        const ok = runGuard();
        if (!ok) return;

        setView('loading');
        setChannel(null);

        void startRoomFlow(ok.intent, ok.roomId)
          .then((ch) => {
            if (runVersion !== currentRun) return;
            setChannel(ch);
            setView('content');
          })
          .catch((err) => {
            if (runVersion !== currentRun) return;
            showError('operation_failed', err);
          });
      } catch (err) {
        if (runVersion !== currentRun) return;
        showError('operation_failed', err);
      }
    };

    runEntry();

    const onPop = (): void => queueMicrotask(runEntry);
    window.addEventListener('popstate', onPop);

    onCleanup(() => {
      runVersion += 1;
      window.removeEventListener('popstate', onPop);
    });
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

      <Show when={view() === 'content' && channel()}>
        {(ch: () => P2pChannel | null) => {
          const value = ch();
          return value ? <RoomWorkspace channel={value} /> : null;
        }}
      </Show>
    </main>
  );
}
