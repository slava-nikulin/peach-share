import { useLocation } from '@solidjs/router';
import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { MetaPanel } from './room/components/MetaPanel';
import { startRoomFlow } from './room/room-init';
import type { Intent, RoomVM } from './room/types';

interface FileItem {
  id: string;
  name: string;
  size: string;
  addedAt: string;
  ownerId: string;
}
interface Peer {
  id: string;
  label: string;
  color: string;
}

const me: Peer = { id: 'YOU-777', label: 'You', color: 'bg-orange-400' };
const guest: Peer = { id: 'B4M9-Z2', label: 'Anna', color: 'bg-rose-400' };

const files: FileItem[] = [
  { id: 'f1', name: 'report_Q3.pdf', size: '2.3 MB', addedAt: '10:21', ownerId: 'YOU-777' },
  { id: 'f2', name: 'family.jpg', size: '1.1 MB', addedAt: '10:22', ownerId: 'YOU-777' },
];

export function Room(): JSX.Element {
  const byOwner = (ownerId: string): FileItem[] => files.filter((f) => f.ownerId === ownerId);

  const location = useLocation<{ secret?: string; intent?: Intent }>();
  const [error, setError] = createSignal<string | null>(null);
  const [vmRef, setVmRef] = createSignal<RoomVM | undefined>(undefined);

  onMount(() => {
    const { vm, stop } = startRoomFlow(
      {
        intent: location.state?.intent ?? 'join',
        secret: location.state?.secret ?? '',
      },
      setError,
    );
    setVmRef(vm);
    onCleanup(stop);
  });

  return <RoomLayout error={error} vmRef={vmRef} byOwner={byOwner} />;
}

interface RoomLayoutProps {
  error: () => string | null;
  vmRef: () => RoomVM | undefined;
  byOwner: (ownerId: string) => FileItem[];
}

function RoomLayout(props: RoomLayoutProps): JSX.Element {
  return (
    <div class="space-y-4">
      <MetaPanel vmRef={props.vmRef()} />
      <Show when={!props.error() && props.vmRef()?.isRtcReady()} fallback={<RtcSkeleton />}>
        <Show when={!props.error()} fallback={<div class="text-red-600">{props.error()}</div>}>
          <RoomOwner files={props.byOwner(me.id)} />
          {guest && <RoomGuest peer={guest} byOwner={props.byOwner} />}
        </Show>
      </Show>
    </div>
  );
}

const RtcSkeleton = (): JSX.Element => (
  <div class="animate-pulse space-y-4">
    <div class="h-6 w-1/3 rounded bg-gray-200" />
    <div class="h-4 w-2/3 rounded bg-gray-200" />
    <div class="h-48 rounded bg-gray-200" />
  </div>
);

const DropzoneCard = (): JSX.Element => (
  <div class="rounded-2xl border border-white/70 bg-white/70 p-4 shadow-sm">
    <div class="flex w-full items-center justify-center">
      <label
        for="dropzone-file"
        class="flex h-44 w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-gray-300 border-dashed bg-gray-50 hover:bg-gray-100 md:h-56"
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
            <span class="font-medium">Кликните</span> или перетащите файлы
          </p>
          <p class="text-gray-500 text-xs">Шэр через комнату. На сервер не грузим</p>
        </div>
        <input id="dropzone-file" type="file" class="hidden" multiple />
      </label>
    </div>
  </div>
);

function PeerHeader(props: { peer: Peer; count: number; you?: boolean }): JSX.Element {
  return (
    <div class="flex items-center justify-between border-gray-200 border-b px-4 py-2">
      <div class="flex min-w-0 items-center gap-2">
        <span class={`h-2.5 w-2.5 rounded-full ${props.peer.color} shrink-0 border border-white`} />
        <span class="truncate font-medium text-sm">
          {props.peer.label}
          {props.you ? ' (вы)' : ''} ·{' '}
          <span class="text-[11px] text-slate-500">{props.peer.id}</span>
        </span>
      </div>
      <span class="rounded-full border border-orange-200 bg-orange-100 px-2 py-0.5 text-[11px] text-orange-800">
        {props.count}
      </span>
    </div>
  );
}

function FileList(props: { files: FileItem[]; mode: 'owner' | 'guest' }): JSX.Element {
  return (
    <div class="p-2">
      <div class="max-h-56 space-y-1.5 overflow-y-auto">
        <For each={props.files}>
          {(file: FileItem) => (
            <div class="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 hover:bg-gray-50">
              <div class="flex min-w-0 flex-1 items-center gap-2">
                <p class="truncate text-slate-800 text-sm">{file.name}</p>
                <span class="shrink-0 text-[11px] text-slate-500">
                  {file.size} · {file.addedAt}
                </span>
              </div>
              {props.mode === 'owner' ? (
                <button
                  type="button"
                  class="rounded border border-rose-200 px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-50"
                >
                  Удалить
                </button>
              ) : (
                <button
                  type="button"
                  class="rounded border border-slate-200 px-2 py-1 text-[11px] hover:bg-slate-50"
                >
                  Скачать
                </button>
              )}
            </div>
          )}
        </For>

        {props.files.length === 0 && (
          <div class="rounded-lg border border-gray-300 border-dashed bg-gray-50 px-3 py-6 text-center text-slate-500 text-sm">
            Нет файлов
          </div>
        )}
      </div>
    </div>
  );
}

/** ====== Новые компоненты под 2 участников ====== */

function RoomOwner(props: { files: FileItem[] }): JSX.Element {
  return (
    <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
      {/* Dropzone слева */}
      <DropzoneCard />
      {/* Карточка владельца на 2 колонки */}
      <div class="flex flex-col rounded-2xl border border-white/70 bg-white/70 shadow-sm md:col-span-2">
        <PeerHeader peer={me} count={props.files.length} you />
        <FileList files={props.files} mode="owner" />
      </div>
    </div>
  );
}

function RoomGuest(props: { peer: Peer; byOwner: (ownerId: string) => FileItem[] }): JSX.Element {
  const files = (): FileItem[] => props.byOwner(props.peer.id);
  return (
    <div class="flex flex-col rounded-2xl border border-white/70 bg-white/70 shadow-sm">
      <PeerHeader peer={props.peer} count={files().length} />
      <FileList files={files()} mode="guest" />
    </div>
  );
}
