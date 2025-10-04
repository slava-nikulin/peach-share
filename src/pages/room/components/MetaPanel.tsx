import { createSignal, onMount, onCleanup, Show } from 'solid-js'
import type { RoomVM } from '../types'

function MetaLabel(props: { children: any }) {
  return (
    <div class="text-xs uppercase tracking-wide text-slate-500">
      {props.children}
    </div>
  )
}

function SkeletonBar(props: { width?: string }) {
  return (
    <div
      class={`h-5 bg-gray-200 rounded ${props.width ?? 'w-32'} animate-pulse`}
    />
  )
}

export default function MetaPanel(props: { vmRef?: RoomVM }) {
  const [isPanelOpen, setOpenPanel] = createSignal(true)
  const [isPakeKeyVisible, setShowPakeKey] = createSignal(false)
  const [copied, setCopied] = createSignal(false)

  async function onCopy() {
    const k = props.vmRef?.pakeKey()
    if (!k) return
    await navigator.clipboard.writeText(k)
    setCopied(true)
    setTimeout(() => setCopied(false), 1000)
  }

  return (
    <div class="rounded-2xl border border-white/70 bg-white/80 backdrop-blur shadow-sm">
      {/* Заголовок панели */}
      <div class="flex items-center justify-between px-4 py-2 border-b border-gray-200">
        <div class="text-sm font-semibold tracking-wide">Мета комнаты</div>
        <button
          type="button"
          class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-gray-100 hover:cursor-pointer"
          title={isPanelOpen() ? 'Скрыть панель' : 'Показать панель'}
          aria-expanded={isPanelOpen()}
          onClick={() => setOpenPanel(!isPanelOpen())}
        >
          <span>{isPanelOpen() ? 'Скрыть' : 'Показать'}</span>
          <svg
            class="w-4 h-4"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
          >
            <path
              d={isPanelOpen() ? 'M5 12l5-5 5 5' : 'M5 8l5 5 5-5'}
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>

      {/* Содержимое */}
      <div class={`px-4 py-3 ${isPanelOpen() ? '' : 'hidden'}`}>
        {/* Updated layout: two columns and three rows as requested */}
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-3 items-center">
            <MetaLabel>Room ID</MetaLabel>
            <div class="font-mono text-sm">
              <span class="px-2 py-0.5 rounded bg-slate-100 border border-slate-200">
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
                    type={isPakeKeyVisible() ? 'text' : 'password'}
                    value={props.vmRef?.pakeKey() ?? ''}
                    readonly
                    class="text-sm px-2 py-1 rounded border border-slate-300 bg-white max-w-xs"
                  />
                  <div
                    class="inline-flex rounded-lg overflow-hidden border border-slate-200"
                    role="group"
                  >
                    <button
                      type="button"
                      class="px-2 py-1 border-r border-slate-200 hover:bg-slate-100 hover:cursor-pointer active:bg-slate-200"
                      title={isPakeKeyVisible() ? 'hide' : 'show'}
                      onClick={() => setShowPakeKey(!isPakeKeyVisible())}
                      aria-pressed={isPakeKeyVisible()}
                    >
                      <svg
                        class="w-5 h-5"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <g
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          {/* веко (контур глаза) */}
                          <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
                          {/* зрачок */}
                          <circle
                            cx="12"
                            cy="12"
                            r="2.5"
                            fill="currentColor"
                            stroke="none"
                          />
                          {/* перечёркивающая диагональ при скрытом состоянии */}
                          <Show when={!isPakeKeyVisible()}>
                            <line x1="3" y1="3" x2="21" y2="21" />
                          </Show>
                        </g>
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="px-2 py-1 border-l border-slate-200 hover:bg-slate-100 active:bg-slate-200
          transition-colors duration-150 ease-out hover:cursor-pointer"
                      title="copy"
                      aria-pressed={copied()}
                      onClick={onCopy}
                    >
                      <Show
                        when={copied()}
                        fallback={
                          // copy icon
                          <svg
                            class="w-5 h-5"
                            viewBox="2 1 20 20"
                            fill="none"
                            aria-hidden="true"
                          >
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
                        {/* check icon */}
                        <svg
                          class="w-5 h-5"
                          viewBox="0 0 24 24"
                          fill="none"
                          aria-hidden="true"
                        >
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
                </div>
              </Show>
            </div>

            <MetaLabel>WebRTC</MetaLabel>
            <div>
              <Show
                when={props.vmRef?.isRtcReady()}
                fallback={<SkeletonBar width="w-20" />}
              >
                <span class="inline-flex items-center gap-2 text-sm">
                  <span class="h-2.5 w-2.5 rounded-full bg-emerald-500 border border-white" />
                  Connected
                </span>
              </Show>
            </div>
          </div>

          <div class="grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-3 items-center">
            <MetaLabel>Auth</MetaLabel>
            <div>
              <Show
                when={(props.vmRef?.authId()?.length ?? 0) > 0}
                fallback={<SkeletonBar width="w-40" />}
              >
                <code class="text-sm break-all">{props.vmRef?.authId()}</code>
              </Show>
            </div>

            <MetaLabel>SAS</MetaLabel>
            <div>
              <Show
                when={(props.vmRef?.sas()?.length ?? 0) > 0}
                fallback={<SkeletonBar width="w-24" />}
              >
                <div class="font-mono text-lg select-all">
                  {props.vmRef?.sas()}
                </div>
              </Show>
            </div>

            <MetaLabel>Cleanup</MetaLabel>
            <div>
              <Show
                when={props.vmRef?.isCleanupDone()}
                fallback={<SkeletonBar width="w-20" />}
              >
                <span class="inline-flex items-center gap-2 text-sm">✅</span>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
