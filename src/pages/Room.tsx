import { useLocation, useNavigate, useParams } from '@solidjs/router'
import { get, onValue, ref, runTransaction } from 'firebase/database'
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { db, ensureAnon, rtdbConnectedSubscribe } from '../config/firebase'

type FileItem = {
  id: string
  name: string
  size: string
  addedAt: string
  ownerId: string
}
type Peer = { id: string; label: string; color: string }

const me: Peer = { id: 'YOU-777', label: 'You', color: 'bg-orange-400' }
const others: Peer[] = [{ id: 'B4M9-Z2', label: 'Anna', color: 'bg-rose-400' }]

const files: FileItem[] = [
  // мои
  {
    id: 'f1',
    name: 'report_Q3.pdf',
    size: '2.3 MB',
    addedAt: '10:21',
    ownerId: me.id,
  },
  {
    id: 'f2',
    name: 'family.jpg',
    size: '1.1 MB',
    addedAt: '10:22',
    ownerId: me.id,
  },
  {
    id: 'f3',
    name: 'notes.txt',
    size: '4 KB',
    addedAt: '10:22',
    ownerId: me.id,
  },
  {
    id: 'f4',
    name: 'slides.pptx',
    size: '18.7 MB',
    addedAt: '10:23',
    ownerId: me.id,
  },
  {
    id: 'f1',
    name: 'report_Q3.pdf',
    size: '2.3 MB',
    addedAt: '10:21',
    ownerId: me.id,
  },
  {
    id: 'f2',
    name: 'family.jpg',
    size: '1.1 MB',
    addedAt: '10:22',
    ownerId: me.id,
  },
  {
    id: 'f3',
    name: 'notes.txt',
    size: '4 KB',
    addedAt: '10:22',
    ownerId: me.id,
  },
  {
    id: 'f4',
    name: 'slides.pptx',
    size: '18.7 MB',
    addedAt: '10:23',
    ownerId: me.id,
  },
  // другие
  {
    id: 'f7',
    name: 'diagram.png',
    size: '640 KB',
    addedAt: '10:26',
    ownerId: 'B4M9-Z2',
  },
  {
    id: 'f8',
    name: 'invoice_4481.pdf',
    size: '880 KB',
    addedAt: '10:28',
    ownerId: 'B4M9-Z2',
  },
  {
    id: 'f9',
    name: 'video_clip.mp4',
    size: '92 MB',
    addedAt: '10:26',
    ownerId: 'J1X7-P5',
  },
  {
    id: 'f10',
    name: 'readme.md',
    size: '2 KB',
    addedAt: '10:27',
    ownerId: 'Q8D2-L1',
  },
  {
    id: 'f11',
    name: 'photo2.jpg',
    size: '1.6 MB',
    addedAt: '10:29',
    ownerId: 'Q8D2-L1',
  },
  {
    id: 'f12',
    name: 'photo3.jpg',
    size: '1.7 MB',
    addedAt: '10:30',
    ownerId: 'Q8D2-L1',
  },
  {
    id: 'f10',
    name: 'readme.md',
    size: '2 KB',
    addedAt: '10:27',
    ownerId: 'Q8D2-L1',
  },
  {
    id: 'f11',
    name: 'photo2.jpg',
    size: '1.6 MB',
    addedAt: '10:29',
    ownerId: 'Q8D2-L1',
  },
  {
    id: 'f12',
    name: 'photo3.jpg',
    size: '1.7 MB',
    addedAt: '10:30',
    ownerId: 'Q8D2-L1',
  },
]

type RoomRecord = {
  room_id: string
  owner: string
  created_at: number
  updated_at: number
}

export default function Room() {
  // Предполагается, что эти сущности у вас выше
  // const files: FileItem[] = ...
  // const me: Peer = ...
  // const others: Peer[] = ...
  const byOwner = (ownerId: string) =>
    files.filter((f) => f.ownerId === ownerId)

  const params = useParams<{ id: string }>()
  const location = useLocation<{
    secret?: string
    intent?: 'create' | 'join'
  }>()
  const navigate = useNavigate()

  // Этапы: RTDB connect, create/read room
  const [isConnecting, setIsConnecting] = createSignal(true)
  const [isCreating, setIsCreating] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [secret, setSecret] = createSignal<string | null>(null)

  // Доп. флаги для мета-панели (эмуляция жизненного цикла)
  const [isMetaOpen, setIsMetaOpen] = createSignal(true)

  const [isAuthed, setIsAuthed] = createSignal(false)
  const [authId, setAuthId] = createSignal<string | null>(null)

  const [pakeKey, setPakeKey] = createSignal<string | null>(null)
  const [showPakeKey, setShowPakeKey] = createSignal(false)

  const [isPakeReady, setIsPakeReady] = createSignal(false)
  const [sas, setSas] = createSignal<string | null>(null)

  const [isRtcReady, setIsRtcReady] = createSignal(false)

  // Guard и подписки (оставлено как есть — закомментировано вами)
  onMount(() => {
    // const s =
    //   location.state?.secret ??
    //   sessionStorage.getItem(`room_secret:${params.id}`)
    // if (!s) {
    //   navigate('/', { replace: true })
    //   return
    // }
    // setSecret(s)
    // sessionStorage.setItem(`room_secret:${params.id}`, s)
    // const navIntent =
    //   location.state?.intent ??
    //   (sessionStorage.getItem(`room_intent:${params.id}`) as
    //     | 'create'
    //     | 'join'
    //     | null)
    // if (navIntent) {
    //   sessionStorage.setItem(`room_intent:${params.id}`, navIntent)
    // }
    // // Подписка на /.info/connected => true когда клиент подключён к RTDB
    // const unsub = rtdbConnectedSubscribe(db, (connected) =>
    //   setIsConnecting(!connected)
    // )
    // onCleanup(unsub)
  })

  // Ожидание RTDB-коннекта
  const waitConnected = () =>
    new Promise<void>((resolve) => {
      if (!isConnecting()) return resolve()
      const iv = setInterval(() => {
        if (!isConnecting()) {
          clearInterval(iv)
          resolve()
        }
      }, 50)
    })

  // Основной поток (оставлен ваш комментарий; реальная логика пока отключена)
  onMount(async () => {
    try {
      // // 1) Анонимная аутентификация (для прохождения правил на чтение/запись)
      // const uid = await ensureAnon()
      // // 2) Подключение к RTDB
      // await waitConnected()
      // // 3) Ветвление по intent
      // const intent =
      //   location.state?.intent ??
      //   (sessionStorage.getItem(`room_intent:${params.id}`) as
      //     | 'create'
      //     | 'join'
      //     | null) ??
      //   'join'
      // const roomRef = ref(db, `rooms/${params.id}`)
      // if (intent === 'create') {
      //   const now = Date.now()
      //   const payload: RoomRecord = {
      //     room_id: params.id,
      //     owner: uid,
      //     created_at: now,
      //     updated_at: now,
      //   }
      //   // Создать запись только если её ещё нет (атомарно)
      //   await runTransaction(
      //     roomRef,
      //     (cur: RoomRecord | null) => cur ?? payload
      //   )
      //   setIsCreating(false)
      // } else if (intent === 'join') {
      //   const snap = await get(roomRef)
      //   if (snap.exists()) {
      //     setIsCreating(false)
      //   } else {
      //     let off: () => void
      //     await new Promise<void>((resolve, reject) => {
      //       off = onValue(
      //         roomRef,
      //         (s) => {
      //           if (s.exists()) {
      //             off()
      //             resolve()
      //           }
      //         },
      //         (e) => {
      //           off()
      //           reject(e)
      //         }
      //       )
      //     })
      //     setIsCreating(false)
      //   }
      // }
    } catch (e: any) {
      setError(e?.message ?? String(e))
      // setIsCreating(false) // эмуляция ниже таймерами
    }

    // ЭМУЛЯЦИЯ ЖИЗНЕННОГО ЦИКЛА ДЛЯ ОТЛАДКИ UI (таймеры):
    const t1 = setTimeout(() => {
      setIsConnecting(false) // RTDB connected
      setIsAuthed(true)
      setAuthId('anon:DEMO-123456')
    }, 3200)

    const t2 = setTimeout(() => {
      setIsCreating(false) // Room created/read
      // Генерация демо-ключа для PAKE на основе секретa/room_id
      const seed = secret() ?? `room:${params.id}`
      setPakeKey(`pake-${btoa(seed).slice(0, 12)}`)
    }, 6600)

    const t3 = setTimeout(() => {
      setIsPakeReady(true)
      // Демо SAS — визуальная проверка
      setSas('🟣 ◻️ 🔶 ◼️')
    }, 9100)

    const t4 = setTimeout(() => {
      setIsRtcReady(true)
    }, 12700)

    onCleanup(() => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
      clearTimeout(t4)
    })
  })

  return (
    <div class="space-y-4">
      {/* МЕТА-ПАНЕЛЬ — видна сразу, основной контент ниже может быть скрыт скелетоном */}
      <MetaPanel
        open={isMetaOpen()}
        onToggle={() => setIsMetaOpen((v) => !v)}
        roomId={params.id}
        isAuthed={isAuthed()}
        authId={authId()}
        roomReady={!isCreating()}
        pakeKey={pakeKey()}
        showKey={showPakeKey()}
        onToggleShowKey={() => setShowPakeKey((v) => !v)}
        onCopyKey={() => pakeKey() && navigator.clipboard.writeText(pakeKey()!)}
        isPakeReady={isPakeReady()}
        sas={sas()}
        isRtcReady={isRtcReady()}
        isConnecting={isConnecting()}
      />

      <Show
        when={!isConnecting() && !isCreating()}
        fallback={
          <div class="animate-pulse space-y-4">
            <div class="h-6 bg-gray-200 rounded w-1/3" />
            <div class="h-4 bg-gray-200 rounded w-2/3" />
            <div class="h-48 bg-gray-200 rounded" />
          </div>
        }
      >
        <Show
          when={!error()}
          fallback={<div class="text-red-600">{error()}</div>}
        >
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Dropzone 1/3 */}
            <div class="rounded-2xl border border-white/70 bg-white/70 shadow-sm p-4">
              <div class="flex items-center justify-center w-full">
                <label
                  for="dropzone-file"
                  class="flex flex-col items-center justify-center w-full h-44 md:h-56 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer bg-gray-50 hover:bg-gray-100"
                >
                  <div class="flex flex-col items-center justify-center pt-5 pb-6 text-center">
                    <svg
                      class="w-7 h-7 mb-2 text-gray-500"
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
                    <p class="text-sm text-gray-600">
                      <span class="font-medium">Кликните</span> или перетащите
                      файлы
                    </p>
                    <p class="text-xs text-gray-500">
                      Шэр через комнату. На сервер не грузим
                    </p>
                  </div>
                  <input
                    id="dropzone-file"
                    type="file"
                    class="hidden"
                    multiple
                  />
                </label>
              </div>
            </div>

            {/* Мой список 2/3 */}
            <div class="md:col-span-2 rounded-2xl border border-white/70 bg-white/70 shadow-sm flex flex-col">
              <PeerHeader peer={me} count={byOwner(me.id).length} you />
              <FileList files={byOwner(me.id)} mode="owner" />
            </div>
          </div>

          {/* Строки 2–4: остальные */}
          <For each={others.slice(0, 3)}>
            {(p) => (
              <div class="rounded-2xl border border-white/70 bg-white/70 shadow-sm flex flex-col">
                <PeerHeader peer={p} count={byOwner(p.id).length} />
                <FileList files={byOwner(p.id)} mode="guest" />
              </div>
            )}
          </For>
        </Show>
      </Show>
    </div>
  )
}

function MetaPanel(props: {
  open: boolean
  onToggle: () => void
  roomId: string
  isConnecting: boolean

  isAuthed: boolean
  authId: string | null

  roomReady: boolean
  pakeKey: string | null
  showKey: boolean
  onToggleShowKey: () => void
  onCopyKey: () => void

  isPakeReady: boolean
  sas: string | null

  isRtcReady: boolean
}) {
  return (
    <div class="rounded-2xl border border-white/70 bg-white/80 backdrop-blur shadow-sm">
      {/* Заголовок панели */}
      <div class="flex items-center justify-between px-4 py-2 border-b border-gray-200">
        <div class="text-sm font-semibold tracking-wide">Мета комнаты</div>
        <button
          type="button"
          class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-gray-100"
          title={props.open ? 'Скрыть панель' : 'Показать панель'}
          aria-expanded={props.open}
          onClick={props.onToggle}
        >
          <span>{props.open ? 'Скрыть' : 'Показать'}</span>
          <svg
            class="w-4 h-4"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
          >
            <path
              d={props.open ? 'M5 12l5-5 5 5' : 'M5 8l5 5 5-5'}
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>

      {/* Содержимое */}
      <div class={`px-4 py-3 ${props.open ? '' : 'hidden'}`}>
        <div class="grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-2 items-center">
          {/* Room ID — сразу */}
          <MetaLabel>Room ID</MetaLabel>
          <div class="font-mono text-sm">
            <span class="px-2 py-0.5 rounded bg-slate-100 border border-slate-200">
              {props.roomId}
            </span>
          </div>

          {/* Auth ID — после isAuthed */}
          <MetaLabel>Auth</MetaLabel>
          <div>
            <Show
              when={props.isAuthed && props.authId}
              fallback={<SkeletonBar width="w-40" />}
            >
              <code class="text-sm break-all">{props.authId}</code>
            </Show>
          </div>

          {/* PAKE key — после roomReady */}
          <MetaLabel>PAKE key</MetaLabel>
          <div>
            <Show
              when={props.roomReady && props.pakeKey}
              fallback={<SkeletonBar width="w-56" />}
            >
              <div class="flex items-center gap-2">
                <input
                  type={props.showKey ? 'text' : 'password'}
                  value={props.pakeKey!}
                  readonly
                  class="text-sm px-2 py-1 rounded border border-slate-300 bg-white w-full max-w-xs"
                />
                <div class="inline-flex rounded-lg overflow-hidden border border-slate-200">
                  <button
                    type="button"
                    class="px-2 py-1 hover:bg-slate-50"
                    title="show"
                    onClick={props.onToggleShowKey}
                    aria-pressed={props.showKey}
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
                          props.showKey
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
                    onClick={props.onCopyKey}
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

          {/* SAS — после isPakeReady */}
          <MetaLabel>SAS</MetaLabel>
          <div>
            <Show
              when={props.isPakeReady && props.sas}
              fallback={<SkeletonBar width="w-24" />}
            >
              <div class="font-mono text-lg select-all">{props.sas}</div>
            </Show>
          </div>

          {/* WebRTC — после isRtcReady */}
          <MetaLabel>WebRTC</MetaLabel>
          <div>
            <Show
              when={props.isRtcReady}
              fallback={<SkeletonBar width="w-20" />}
            >
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

function PeerHeader(props: { peer: Peer; count: number; you?: boolean }) {
  return (
    <div class="flex items-center justify-between px-4 py-2 border-b border-gray-200">
      <div class="flex items-center gap-2 min-w-0">
        <span
          class={`h-2.5 w-2.5 rounded-full ${props.peer.color} border border-white shrink-0`}
        />
        <span class="text-sm font-medium truncate">
          {props.peer.label}
          {props.you ? ' (вы)' : ''} ·{' '}
          <span class="text-[11px] text-slate-500">{props.peer.id}</span>
        </span>
      </div>
      <span class="text-[11px] px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 border border-orange-200">
        {props.count}
      </span>
    </div>
  )
}

function FileList(props: { files: FileItem[]; mode: 'owner' | 'guest' }) {
  return (
    <div class="p-2">
      <div class="max-h-56 overflow-y-auto space-y-1.5">
        <For each={props.files}>
          {(f) => (
            <div class="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 hover:bg-gray-50">
              {/* имя слева, мета справа на одной строке */}
              <div class="min-w-0 flex-1 flex items-center gap-2">
                <p class="truncate text-sm text-slate-800">{f.name}</p>
                <span class="shrink-0 text-[11px] text-slate-500">
                  {f.size} · {f.addedAt}
                </span>
              </div>
              {props.mode === 'owner' ? (
                <button
                  type="button"
                  class="text-[11px] px-2 py-1 rounded border border-rose-200 text-rose-700 hover:bg-rose-50"
                >
                  Удалить
                </button>
              ) : (
                <button
                  type="button"
                  class="text-[11px] px-2 py-1 rounded border border-slate-200 hover:bg-slate-50"
                >
                  Скачать
                </button>
              )}
            </div>
          )}
        </For>

        {props.files.length === 0 && (
          <div class="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-6 text-center text-sm text-slate-500">
            Нет файлов
          </div>
        )}
      </div>
    </div>
  )
}
