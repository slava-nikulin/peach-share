import { For } from 'solid-js'

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

export default function Room() {
  const byOwner = (ownerId: string) =>
    files.filter((f) => f.ownerId === ownerId)

  return (
    <div class="space-y-4">
      {/* Строка 1: я. grid 1/3 + 2/3 */}
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
                  <span class="font-medium">Кликните</span> или перетащите файлы
                </p>
                <p class="text-xs text-gray-500">
                  Шэр через комнату. На сервер не грузим
                </p>
              </div>
              <input id="dropzone-file" type="file" class="hidden" multiple />
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
