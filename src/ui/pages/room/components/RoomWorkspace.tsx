/** biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: <explanation> */
import type { JSX } from 'solid-js';
import { createSignal, For, Show, onCleanup } from 'solid-js';
import type { P2pChannel } from '../../../../bll/ports/p2p-channel';
import { createRoomSession, type FileDesc, type TransferState } from '../../room/create-room-session';

export function RoomWorkspace(props: { channel: P2pChannel }): JSX.Element {
  const [myFiles, setMyFiles] = createSignal<FileDesc[]>([]);
  const [peerFiles, setPeerFiles] = createSignal<FileDesc[]>([]);
  const [transfers, setTransfers] = createSignal<TransferState[]>([]);

  const session = createRoomSession({
    channel: props.channel,
    getMyFiles: myFiles,
    setMyFiles,
    getPeerFiles: peerFiles,
    setPeerFiles,
    getTransfers: transfers,
    setTransfers,
    onDownloadedFile: (file) => {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    },
  });

  onCleanup(() => session.dispose());

  const onPickFiles: JSX.EventHandler<HTMLInputElement, Event> = async (e) => {
    const input = e.currentTarget;
    if (!input.files || input.files.length === 0) return;
    await session.addMyFiles(input.files);
    input.value = '';
  };

  return (
    <div class="space-y-4">
      <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Dropzone */}
        <div class="rounded-2xl border border-white/70 bg-white/70 p-4 shadow-sm">
          <label class="flex h-44 w-full flex-col items-center justify-center rounded-xl border-2 border-gray-300 border-dashed bg-gray-50 hover:cursor-pointer hover:bg-gray-100 md:h-56">
            <div class="text-center text-sm text-gray-600">
              <span class="font-medium">Click</span> to upload
              <div class="text-xs text-gray-500">Or drag files here</div>
            </div>
            <input type="file" class="hidden" multiple onChange={onPickFiles} />
          </label>
        </div>

        {/* You */}
        <div class="flex flex-col rounded-2xl border border-white/70 bg-white/70 shadow-sm md:col-span-2">
          <div class="flex items-center justify-between border-gray-200 border-b px-4 py-2">
            <div class="flex min-w-0 items-center gap-2">
              <span class="h-2.5 w-2.5 shrink-0 rounded-full border border-white bg-emerald-500" />
              <span class="truncate font-medium text-sm">You</span>
            </div>
            <span class="rounded-full border border-orange-200 bg-orange-100 px-2 py-0.5 text-[11px] text-orange-800">
              {myFiles().length}
            </span>
          </div>

          <div class="p-2">
            <div class="max-h-56 space-y-1.5 overflow-y-auto">
              <Show
                when={myFiles().length > 0}
                fallback={
                  <div class="rounded-lg border border-gray-300 border-dashed bg-gray-50 px-3 py-6 text-center text-slate-500 text-sm">
                    No files
                  </div>
                }
              >
                <For each={myFiles()}>
                  {(f) => (
                    <div class="flex items-center justify-between rounded-lg border bg-white px-3 py-2">
                      <div class="min-w-0">
                        <div class="truncate text-sm">{f.name}</div>
                        <div class="text-xs text-slate-500">{f.size} bytes</div>
                      </div>
                      <button
                        class="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50"
                        onClick={() => session.unshare(f.id)}
                      >
                        Unshare
                      </button>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </div>
      </div>

      {/* Guest */}
      <div class="flex flex-col rounded-2xl border border-white/70 bg-white/70 shadow-sm">
        <div class="flex items-center justify-between border-gray-200 border-b px-4 py-2">
          <div class="flex min-w-0 items-center gap-2">
            <span class="h-2.5 w-2.5 shrink-0 rounded-full border border-white bg-sky-500" />
            <span class="truncate font-medium text-sm">Guest</span>
          </div>
          <span class="rounded-full border border-orange-200 bg-orange-100 px-2 py-0.5 text-[11px] text-orange-800">
            {peerFiles().length}
          </span>
        </div>

        <div class="p-2">
          <div class="max-h-56 space-y-1.5 overflow-y-auto">
            <Show
              when={peerFiles().length > 0}
              fallback={
                <div class="rounded-lg border border-gray-300 border-dashed bg-gray-50 px-3 py-6 text-center text-slate-500 text-sm">
                  No files
                </div>
              }
            >
              <For each={peerFiles()}>
                {(f) => (
                  <div class="flex items-center justify-between rounded-lg border bg-white px-3 py-2">
                    <div class="min-w-0">
                      <div class="truncate text-sm">{f.name}</div>
                      <div class="text-xs text-slate-500">{f.size} bytes</div>
                    </div>
                    <button
                      class="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50"
                      onClick={() => session.requestDownload(f.id)}
                    >
                      Download
                    </button>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>
      </div>

      {/* Transfers (минимально, для проверки) */}
      <div class="rounded-2xl border border-white/70 bg-white/70 p-3 text-sm">
        <div class="font-medium">Transfers</div>
        <Show
          when={transfers().length > 0}
          fallback={<div class="text-slate-500">No transfers</div>}
        >
          <For each={transfers()}>
            {(t) => (
              <div class="flex items-center justify-between border-t py-1">
                <div class="truncate">
                  {t.dir} {t.fileId} — {t.status}
                  <Show when={t.error}>
                    <span class="text-red-600"> ({t.error})</span>
                  </Show>
                </div>
                <div class="tabular-nums">{t.percentage.toFixed(1)}%</div>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
