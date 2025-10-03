import { createSignal, onMount, onCleanup, Show } from 'solid-js'

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
      class={`h-4 bg-gray-200 rounded ${props.width ?? 'w-32'} animate-pulse`}
    />
  )
}

type MetaApi = {
  setOpen: (v: boolean) => void
  toggleOpen: () => void
  setAuthed: (v: boolean) => void
  setAuthId: (id: string | null) => void
  setRoomReady: (v: boolean) => void
  setPakeKey: (key: string | null) => void
  setPakeReady: (v: boolean) => void
  setSas: (s: string | null) => void
  setRtcReady: (v: boolean) => void
  togglePakeVisibility: () => void
  showPake: () => void
  hidePake: () => void
  copyPakeKey: () => void
  getState: () => any
}

export default function MetaPanel(props: {
  data: {
    roomId: string
  }
  apiRef?: (api: MetaApi | null) => void
}) {
  // internal flags/data owned by the component
  const [open, setOpen] = createSignal(true)

  const [isAuthed, setIsAuthed] = createSignal(false)
  const [authId, setAuthId] = createSignal<string | null>(null)

  const [roomReady, setRoomReady] = createSignal(false)
  const [pakeKey, setPakeKey] = createSignal<string | null>(null)
  const [showKey, setShowKey] = createSignal(false)

  const [isPakeReady, setIsPakeReady] = createSignal(false)
  const [sas, setSas] = createSignal<string | null>(null)

  const [isRtcReady, setIsRtcReady] = createSignal(false)

  function copyPakeKey() {
    const k = pakeKey()
    if (k) navigator.clipboard.writeText(k)
  }

  const api: MetaApi = {
    setOpen: (v) => setOpen(v),
    toggleOpen: () => setOpen((v) => !v),
    setAuthed: (v) => setIsAuthed(v),
    setAuthId: (id) => setAuthId(id),
    setRoomReady: (v) => setRoomReady(v),
    setPakeKey: (k) => setPakeKey(k),
    setPakeReady: (v) => setIsPakeReady(v),
    setSas: (s) => setSas(s),
    setRtcReady: (v) => setIsRtcReady(v),
    togglePakeVisibility: () => setShowKey((v) => !v),
    showPake: () => setShowKey(true),
    hidePake: () => setShowKey(false),
    copyPakeKey: () => copyPakeKey(),
    getState: () => ({
      open: open(),
      isAuthed: isAuthed(),
      authId: authId(),
      roomReady: roomReady(),
      pakeKey: pakeKey(),
      showKey: showKey(),
      isPakeReady: isPakeReady(),
      sas: sas(),
      isRtcReady: isRtcReady(),
    }),
  }

  onMount(() => {
    props.apiRef && props.apiRef(api)
  })
  onCleanup(() => props.apiRef && props.apiRef(null))

  return (
    <div class="rounded-2xl border border-white/70 bg-white/80 backdrop-blur shadow-sm">
      {/* Заголовок панели */}
      <div class="flex items-center justify-between px-4 py-2 border-b border-gray-200">
        <div class="text-sm font-semibold tracking-wide">Мета комнаты</div>
        <button
          type="button"
          class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-gray-100"
          title={open() ? 'Скрыть панель' : 'Показать панель'}
          aria-expanded={open()}
          onClick={() => api.toggleOpen()}
        >
          <span>{open() ? 'Скрыть' : 'Показать'}</span>
          <svg
            class="w-4 h-4"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
          >
            <path
              d={open() ? 'M5 12l5-5 5 5' : 'M5 8l5 5 5-5'}
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>

      {/* Содержимое */}
      <div class={`px-4 py-3 ${open() ? '' : 'hidden'}`}>
        {/* Updated layout: two columns and three rows as requested */}
        <div class="grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-3 items-center">
          {/* Row 1: Room ID | Auth ID */}
          <MetaLabel>Room ID</MetaLabel>
          <div class="font-mono text-sm">
            <span class="px-2 py-0.5 rounded bg-slate-100 border border-slate-200">
              {props.data.roomId}
            </span>
          </div>

          <MetaLabel>Auth</MetaLabel>
          <div>
            <Show
              when={isAuthed() && authId()}
              fallback={<SkeletonBar width="w-40" />}
            >
              <code class="text-sm break-all">{authId()}</code>
            </Show>
          </div>

          {/* Row 2: PAKE key | SAS */}
          <MetaLabel>PAKE key</MetaLabel>
          <div>
            <Show
              when={roomReady() && pakeKey()}
              fallback={<SkeletonBar width="w-56" />}
            >
              <div class="flex items-center gap-2">
                <input
                  type={showKey() ? 'text' : 'password'}
                  value={pakeKey() ?? ''}
                  readonly
                  class="text-sm px-2 py-1 rounded border border-slate-300 bg-white w-full max-w-xs"
                />
                <div class="inline-flex rounded-lg overflow-hidden border border-slate-200">
                  <button
                    type="button"
                    class="px-2 py-1 hover:bg-slate-50"
                    title="show"
                    onClick={() => api.togglePakeVisibility()}
                    aria-pressed={showKey()}
                  >
                    {/* глаз / глаз-зачёркнутый */}
                    <svg
                      class="w-4 h-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d={
                          showKey()
                            ? 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z'
                            : 'M3 3l18 18M3.6 6.2C5.4 4.5 7.9 3 12 3c6 0 10 9 10 9a18.7 18.7 0 0 1-4.2 5.4M8.6 8.6A4 4 0 0 1 15.4 15.4'
                        }
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    class="px-2 py-1 hover:bg-slate-50"
                    title="copy"
                    onClick={() => api.copyPakeKey()}
                  >
                    <svg
                      class="w-4 h-4"
                      viewBox="0 0 24 24"
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
                  </button>
                </div>
              </div>
            </Show>
          </div>

          <MetaLabel>SAS</MetaLabel>
          <div>
            <Show
              when={isPakeReady() && sas()}
              fallback={<SkeletonBar width="w-24" />}
            >
              <div class="font-mono text-lg select-all">{sas()}</div>
            </Show>
          </div>

          {/* Row 3: WebRTC status spans both columns visually via label + value */}
          <MetaLabel>WebRTC</MetaLabel>
          <div>
            <Show when={isRtcReady()} fallback={<SkeletonBar width="w-20" />}>
              <span class="inline-flex items-center gap-2 text-sm">
                <span class="h-2.5 w-2.5 rounded-full bg-emerald-500 border border-white" />
                Connected
              </span>
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}
