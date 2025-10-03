import { useLocation, useNavigate, useParams } from '@solidjs/router'
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import MetaPanel from '../components/MetaPanel'

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
  // мои (shortened)
  {
    id: 'f1',
    name: 'report_Q3.pdf',
    size: '2.3 MB',
    addedAt: '10:21',
    ownerId: 'YOU-777',
  },
  {
    id: 'f2',
    name: 'family.jpg',
    size: '1.1 MB',
    addedAt: '10:22',
    ownerId: 'YOU-777',
  },
]

// MetaPanel moved to src/components/MetaPanel.tsx
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
  // mark as used (no-ops) so TS doesn't complain when these are referenced only in comments
  void location
  void navigate

  // Этапы: RTDB connect, create/read room
  const [error, setError] = createSignal<string | null>(null)

  // MetaPanel owns its internal signals now. We'll call its API via apiRef.
  let metaApi: any = null

  // helper to set api when mounted
  const setMetaApi = (a: any | null) => (metaApi = a)

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

    const sleep = 3000
    let curTimeout = 0

    curTimeout += sleep
    const t0 = setTimeout(() => {
      metaApi?.setConnecting(false)
    }, curTimeout)

    curTimeout += sleep
    const t1 = setTimeout(() => {
      metaApi?.setIsConnecting(false) // RTDB connected (still in Room)
      metaApi?.setAuthed?.(true)
      metaApi?.setAuthId?.('anon:DEMO-123456')
    }, curTimeout)

    curTimeout += sleep
    const t2 = setTimeout(() => {
      // Генерация демо-ключа для PAKE на основе секретa/room_id
      const seed = location.state?.secret ?? `room:${params.id}`
      metaApi?.setPakeKey?.(`pake-${btoa(seed).slice(0, 12)}`)
      metaApi?.setRoomReady?.(true)
    }, curTimeout)

    curTimeout += sleep
    const t3 = setTimeout(() => {
      metaApi?.setPakeReady?.(true)
      // Демо SAS — визуальная проверка
      metaApi?.setSas?.('🟣 ◻️ 🔶 ◼️')
    }, curTimeout)

    curTimeout += sleep
    const t4 = setTimeout(() => {
      metaApi?.setRtcReady?.(true)
    }, curTimeout)

    onCleanup(() => {
      clearTimeout(t0)
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
      clearTimeout(t4)
    })
  })

  return (
    <div class="space-y-4">
      {/* МЕТА-ПАНЕЛЬ — видна сразу, основной контент ниже может быть скрыт скелетоном */}
      <MetaPanel data={{ roomId: params.id }} apiRef={setMetaApi} />

      <Show
        when={!metaApi?.getState().isRtcReady()}
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
