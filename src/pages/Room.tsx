// Room.tsx TODO: переделать. Намудрил с высчитыванием размеров
import { useParams } from '@solidjs/router'
import { createMemo, onCleanup, onMount } from 'solid-js'
import { sessionStore } from '../state/sessionStore'

type FileItem = { id: string; name: string; size: string; ext: string }
type Participant = {
  id: string
  label: string
  color: string
  files: FileItem[]
}

export default function Room() {
  onMount(async () => {
    const { roomId } = useParams()
    let s = sessionStore.get(roomId)
    if (!s) {
      // если пришли по прямой ссылке/обновили — создайте сессию заново или верните на / с сообщением
      // здесь для краткости просто выходим
      return
    }
    await s.connect()
  })
  onCleanup(() => {
    const { roomId } = useParams()
    sessionStore.get(roomId!)?.disconnect()
  })

  // ---- Mock participants (до 4) ----
  const participants: Participant[] = [
    {
      id: 'p1',
      label: 'Участник A',
      color: 'bg-orange-200 text-orange-900',
      files: [
        { id: 'f1', name: 'design-spec.pdf', size: '1.2 MB', ext: 'PDF' },
        { id: 'f2', name: 'logo.png', size: '340 KB', ext: 'PNG' },
        { id: 'f3', name: 'readme.md', size: '4 KB', ext: 'MD' },
      ],
    },
    {
      id: 'p2',
      label: 'Участник B',
      color: 'bg-rose-200 text-rose-900',
      files: [
        { id: 'f4', name: 'photo-001.jpg', size: '2.8 MB', ext: 'JPG' },
        { id: 'f5', name: 'clip.mp4', size: '18.4 MB', ext: 'MP4' },
      ],
    },
    {
      id: 'p3',
      label: 'Участник C',
      color: 'bg-amber-200 text-amber-900',
      files: [
        { id: 'f6', name: 'notes.txt', size: '12 KB', ext: 'TXT' },
        { id: 'f7', name: 'dataset.csv', size: '730 KB', ext: 'CSV' },
        { id: 'f8', name: 'diagram.svg', size: '56 KB', ext: 'SVG' },
        { id: 'f9', name: 'archive.zip', size: '6.2 MB', ext: 'ZIP' },
      ],
    },
  ]

  const n = participants.length // 1..4
  // Высота карточки участника: занимать равные доли видимой области под дроп-зоной
  //  calc( (100vh - Hdropzone - внешние отступы) / N )
  const minPaneHeight = createMemo(() => `calc((100vh - 260px) / ${n || 1})`)

  return (
    <div class="space-y-6">
      {/* Dropzone (Flowbite-паттерн, без загрузки на сервер) */}
      <section class="rounded-2xl border border-white/70 bg-white/70 p-4 shadow-sm">
        <div class="flex items-center justify-between mb-3">
          <div>
            <h2 class="text-lg font-semibold">Добавить файлы</h2>
            <p class="text-xs text-slate-600">
              Файлы не загружаются в облако — они будут доступны пир-клиентам по
              P2P.
            </p>
          </div>
          <span class="text-xs text-slate-500">Участники: {n}/4</span>
        </div>

        <div class="flex items-center justify-center w-full">
          <label
            for="dropzone-file"
            class="flex flex-col items-center justify-center w-full h-44 md:h-56 border-2 border-dashed rounded-2xl cursor-pointer bg-orange-50/60 hover:bg-orange-50 border-orange-200"
          >
            <div class="flex flex-col items-center justify-center pt-5 pb-6">
              <svg
                class="w-10 h-10 mb-3 text-orange-400"
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 20 16"
              >
                <path
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6m0 0L8 8m2-2 2 2"
                />
              </svg>
              <p class="mb-1 text-sm text-slate-700">
                <span class="font-semibold">Выберите файл</span> или перетащите
                сюда
              </p>
              <p class="text-xs text-slate-500">
                Любые типы. Никакой загрузки на сервер.
              </p>
            </div>
            <input id="dropzone-file" type="file" class="hidden" multiple />
          </label>
        </div>
      </section>

      {/* Список групп по участникам */}
      <section class="grid grid-cols-1 gap-4">
        {participants.map((p) => (
          <article
            class="rounded-2xl border border-white/70 bg-white/70 shadow-sm flex flex-col"
            style={{ 'min-height': minPaneHeight() }}
          >
            {/* Header участника */}
            <header class="flex items-center justify-between px-4 py-3 border-b border-white/70">
              <div class="flex items-center gap-3">
                <div
                  class={`h-8 w-8 rounded-full grid place-items-center text-xs font-semibold ${p.color}`}
                >
                  {p.label.slice(-1)}
                </div>
                <div>
                  <div class="text-sm font-semibold">{p.label}</div>
                  <div class="text-xs text-slate-500">
                    файлов: {p.files.length}
                  </div>
                </div>
              </div>
              <span class="inline-flex items-center gap-1 text-xs text-green-700">
                <span class="h-2 w-2 rounded-full bg-green-500" />
                онлайн
              </span>
            </header>

            {/* Список файлов участника */}
            <div class="flex-1 overflow-auto">
              <ul class="divide-y divide-slate-100">
                {p.files.map((f) => (
                  <li class="px-4 py-3 hover:bg-orange-50/60 transition-colors">
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-3 min-w-0">
                        <FileIcon ext={f.ext} />
                        <div class="min-w-0">
                          <div class="text-sm font-medium truncate">
                            {f.name}
                          </div>
                          <div class="text-xs text-slate-500">{f.size}</div>
                        </div>
                      </div>
                      {/* Заглушка кнопки скачивания — логика позже */}
                      <button
                        type="button"
                        class="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-900/10"
                        disabled
                        title="P2P-скачивание появится позже"
                      >
                        <svg
                          class="w-4 h-4"
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        <span>Скачать</span>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </section>
    </div>
  )
}

function FileIcon(props: { ext: string }) {
  const upper = props.ext.toUpperCase()
  const color =
    upper === 'PDF'
      ? 'bg-rose-100 text-rose-700 border-rose-200'
      : upper === 'PNG' || upper === 'JPG' || upper === 'SVG'
      ? 'bg-orange-100 text-orange-700 border-orange-200'
      : upper === 'MP4'
      ? 'bg-amber-100 text-amber-700 border-amber-200'
      : 'bg-slate-100 text-slate-700 border-slate-200'
  return (
    <span
      class={`inline-flex items-center justify-center h-8 min-w-8 px-2 rounded-md text-[10px] font-semibold border ${color}`}
    >
      {upper}
    </span>
  )
}
