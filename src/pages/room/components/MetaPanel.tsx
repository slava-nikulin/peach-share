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
  const [isPakeKeyVisible, setPakeKeyVisible] = createSignal(false);
  const [copied, setCopied] = createSignal(false);

  const togglePanel = (): boolean => setPanelOpen(!isPanelOpen());
  const togglePakeKey = (): boolean => setPakeKeyVisible(!isPakeKeyVisible());

  const handleCopy = async (): Promise<void> => {
    const key = props.vmRef?.pakeKey();
    if (!key) return;
    await navigator.clipboard.writeText(key);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1000);
  };

  return (
    <PanelContainer
      isOpen={isPanelOpen()}
      onToggle={togglePanel}
      vmRef={props.vmRef}
      isPakeKeyVisible={isPakeKeyVisible()}
      togglePakeKey={togglePakeKey}
      copied={copied()}
      onCopy={handleCopy}
    />
  );
}

interface PanelContainerProps {
  isOpen: boolean;
  onToggle: () => void;
  vmRef?: RoomVM;
  isPakeKeyVisible: boolean;
  togglePakeKey: () => void;
  copied: boolean;
  onCopy: () => Promise<void>;
}

const PanelContainer = (props: PanelContainerProps): JSX.Element => {
  const buttonLabel = props.isOpen ? 'Скрыть' : 'Показать';
  const buttonTitle = props.isOpen ? 'Скрыть панель' : 'Показать панель';
  const chevron = props.isOpen ? 'M5 12l5-5 5 5' : 'M5 8l5 5 5-5';

  return (
    <div class="rounded-2xl border border-white/70 bg-white/80 shadow-sm backdrop-blur">
      <div class="flex items-center justify-between border-gray-200 border-b px-4 py-2">
        <div class="font-semibold text-sm tracking-wide">Мета комнаты</div>
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:cursor-pointer hover:bg-gray-100"
          title={buttonTitle}
          aria-expanded={props.isOpen}
          onClick={props.onToggle}
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
      <div class={`px-4 py-3 ${props.isOpen ? '' : 'hidden'}`}>
        <div class="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div class="grid grid-cols-[140px_minmax(0,1fr)] items-center gap-x-4 gap-y-3">
            <MetaLabel>Room ID</MetaLabel>
            <div class="font-mono text-sm">
              <span class="rounded border border-slate-200 bg-slate-100 px-2 py-0.5">
                {props.vmRef?.roomId()}
              </span>
            </div>

            <MetaLabel>PAKE key</MetaLabel>
            <div>
              <Show
                when={(props.vmRef?.pakeKey()?.length ?? 0) > 0}
                fallback={<SkeletonBar width="w-56" />}
              >
                <div class="flex items-center gap-2">
                  <input
                    name="pakeKey"
                    type={props.isPakeKeyVisible ? 'text' : 'password'}
                    value={props.vmRef?.pakeKey() ?? ''}
                    readonly
                    class="max-w-xs rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                  />
                  <PakeKeyActions
                    isVisible={props.isPakeKeyVisible}
                    toggleVisibility={props.togglePakeKey}
                    copied={props.copied}
                    onCopy={props.onCopy}
                  />
                </div>
              </Show>
            </div>

            <MetaLabel>WebRTC</MetaLabel>
            <div>
              <Show when={props.vmRef?.isRtcReady()} fallback={<SkeletonBar width="w-20" />}>
                <span class="inline-flex items-center gap-2 text-sm">
                  <span class="h-2.5 w-2.5 rounded-full border border-white bg-emerald-500" />
                  Connected
                </span>
              </Show>
            </div>
          </div>

          <div class="grid grid-cols-[140px_minmax(0,1fr)] items-center gap-x-4 gap-y-3">
            <MetaLabel>Auth</MetaLabel>
            <div>
              <Show
                when={(props.vmRef?.authId()?.length ?? 0) > 0}
                fallback={<SkeletonBar width="w-40" />}
              >
                <code class="break-all text-sm">{props.vmRef?.authId()}</code>
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
                <span class="inline-flex items-center gap-2 text-sm">✅</span>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface PakeKeyActionsProps {
  isVisible: boolean;
  toggleVisibility: () => void;
  copied: boolean;
  onCopy: () => Promise<void>;
}

const PakeKeyActions = (props: PakeKeyActionsProps): JSX.Element => (
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
