import { createSignal, type JSX, Show } from 'solid-js';
import type { RoomVM } from '../types';

function MetaLabel(props: { children: JSX.Element | string }): JSX.Element {
  return <div class="text-slate-500 text-xs uppercase tracking-wide">{props.children}</div>;
}

function SkeletonBar(props: { width?: string }): JSX.Element {
  return <div class={`h-5 rounded bg-gray-200 ${props.width ?? 'w-32'} animate-pulse`} />;
}

export function MetaPanel(props: { vmRef?: RoomVM }): JSX.Element {
  const [isPanelOpen, setPanelOpen] = createSignal(true);
  const [isSecretVisible, setSecretVisible] = createSignal(false);
  const [isSecredCopied, setSecretCopied] = createSignal(false);

  const togglePanel = (): boolean => setPanelOpen(!isPanelOpen());
  const toggleSecretVisibility = (): boolean => setSecretVisible(!isSecretVisible());

  const handleSecretCopy = async (): Promise<void> => {
    const key = props.vmRef?.secret();
    if (!key) return;
    await navigator.clipboard.writeText(key);
    setSecretCopied(true);
    window.setTimeout(() => setSecretCopied(false), 1000);
  };

  return (
    <PanelContainer
      isPanelOpen={isPanelOpen()}
      onPanelToggle={togglePanel}
      vmRef={props.vmRef}
      isSecretVisible={isSecretVisible()}
      toggleSecretVisibility={toggleSecretVisibility}
      isSecretCopied={isSecredCopied()}
      onCopySecret={handleSecretCopy}
    />
  );
}

interface PanelContainerProps {
  vmRef?: RoomVM;
  isPanelOpen: boolean;
  onPanelToggle: () => void;
  isSecretVisible: boolean;
  isSecretCopied: boolean;
  toggleSecretVisibility: () => void;
  onCopySecret: () => Promise<void>;
}

const PanelContainer = (props: PanelContainerProps): JSX.Element => {
  const buttonLabel = props.isPanelOpen ? 'Show' : 'Hide';
  const chevron = props.isPanelOpen ? 'M5 12l5-5 5 5' : 'M5 8l5 5 5-5';

  return (
    <div class="rounded-2xl border border-white/70 bg-white/80 shadow-sm backdrop-blur">
      <div class="flex items-center justify-between border-gray-200 border-b px-4 py-2">
        <div class="font-semibold text-sm tracking-wide">Room info</div>
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:cursor-pointer hover:bg-gray-100"
          aria-expanded={props.isPanelOpen}
          onClick={props.onPanelToggle}
        >
          <span>{buttonLabel}</span>
          <svg class="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d={chevron}
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>
      <div class={`px-4 py-3 ${props.isPanelOpen ? '' : 'hidden'}`}>
        <div class="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div class="grid grid-cols-[100px_minmax(0,1fr)] items-center gap-y-3 md:grid-cols-[140px_minmax(0,1fr)]">
            <MetaLabel>Secret</MetaLabel>
            <div class="flex items-center gap-2">
              <input
                name="secret"
                type={props.isSecretVisible ? 'text' : 'password'}
                value={props.vmRef?.secret() ?? ''}
                readonly
                class="min-w-[1ch] max-w-xs flex-1 basis-0 rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              />
              <div class="shrink-0">
                <SecretKeyActions
                  isVisible={props.isSecretVisible}
                  toggleVisibility={props.toggleSecretVisibility}
                  copied={props.isSecretCopied}
                  onCopy={props.onCopySecret}
                />
              </div>
            </div>

            <MetaLabel>PAKE session</MetaLabel>
            <div>
              <Show
                when={(props.vmRef?.pakeKey()?.length ?? 0) > 0}
                fallback={<SkeletonBar width="w-56" />}
              >
                <span class="me-2 rounded-sm bg-green-100 px-2.5 py-0.5 font-medium text-green-800 text-xs dark:bg-green-900 dark:text-green-300">
                  established
                </span>
              </Show>
            </div>

            <MetaLabel>WebRTC</MetaLabel>
            <div>
              <Show when={props.vmRef?.isRtcReady()} fallback={<SkeletonBar width="w-20" />}>
                <span class="me-2 rounded-sm bg-green-100 px-2.5 py-0.5 font-medium text-green-800 text-xs dark:bg-green-900 dark:text-green-300">
                  connected
                </span>
              </Show>
            </div>
          </div>

          <div class="grid grid-cols-[100px_minmax(0,1fr)] items-center gap-x-4 gap-y-3 md:grid-cols-[140px_minmax(0,1fr)]">
            <MetaLabel>Auth</MetaLabel>
            <div>
              <Show
                when={(props.vmRef?.authId()?.length ?? 0) > 0}
                fallback={<SkeletonBar width="w-40" />}
              >
                <span class="me-2 rounded-sm bg-gray-100 px-2.5 py-0.5 font-medium text-gray-800 text-xs dark:bg-gray-700 dark:text-gray-300">
                  {props.vmRef?.authId()}
                </span>
              </Show>
            </div>

            <MetaLabel>SAS</MetaLabel>
            <div>
              <Show
                when={(props.vmRef?.sas()?.length ?? 0) > 0}
                fallback={<SkeletonBar width="w-24" />}
              >
                <div class="select-all font-mono text-lg">{props.vmRef?.sas()}</div>
              </Show>
            </div>

            <MetaLabel>Cleanup</MetaLabel>
            <div>
              <Show when={props.vmRef?.isCleanupDone()} fallback={<SkeletonBar width="w-20" />}>
                <span class="me-2 rounded-sm bg-green-100 px-2.5 py-0.5 font-medium text-green-800 text-xs dark:bg-green-900 dark:text-green-300">
                  done
                </span>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface SecretKeyActionsProps {
  isVisible: boolean;
  toggleVisibility: () => void;
  copied: boolean;
  onCopy: () => Promise<void>;
}

const SecretKeyActions = (props: SecretKeyActionsProps): JSX.Element => (
  <div class="inline-flex overflow-hidden rounded-lg border border-slate-200">
    <button
      type="button"
      class="border-slate-200 border-r px-2 py-1 hover:cursor-pointer hover:bg-slate-100 active:bg-slate-200"
      title={props.isVisible ? 'hide' : 'show'}
      onClick={props.toggleVisibility}
      aria-pressed={props.isVisible}
    >
      <svg class="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
        <g
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
          <Show when={!props.isVisible}>
            <line x1="3" y1="3" x2="21" y2="21" />
          </Show>
        </g>
      </svg>
    </button>
    <button
      type="button"
      class="border-slate-200 border-l px-2 py-1 transition-colors duration-150 ease-out hover:cursor-pointer hover:bg-slate-100 active:bg-slate-200"
      title="copy"
      aria-pressed={props.copied}
      onClick={(): void => {
        void props.onCopy();
      }}
    >
      <Show
        when={props.copied}
        fallback={
          <svg class="h-5 w-5" viewBox="2 1 20 20" fill="none" aria-hidden="true">
            <path
              d="M9 9h10v10H9zM5 5h10v2H7v8H5z"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        }
      >
        <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M5 13l4 4L19 7"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </Show>
    </button>
  </div>
);
