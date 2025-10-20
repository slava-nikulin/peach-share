import { type Accessor, For, type JSX, Show } from 'solid-js';
import { formatFileSize } from './DropZone';
import type { RemoteMeta } from './state';

export const GuestList = (props: {
  files: RemoteMeta[];
  onRequest: (id: string) => void;
}): JSX.Element => (
  <div class="p-2">
    <div class="max-h-56 space-y-1.5 overflow-y-auto">
      <For each={props.files}>
        {(file: RemoteMeta): JSX.Element => (
          <div
            data-testid="remote-file-row"
            data-file-id={file.id}
            data-file-name={file.name}
            data-downloading={file.downloading ? '1' : '0'}
            data-has-url={file.url ? '1' : '0'}
            class="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 hover:bg-gray-50"
          >
            <div class="flex min-w-0 flex-1 items-center gap-2">
              <p class="truncate text-slate-800 text-sm">{file.name}</p>
              <span class="shrink-0 text-[11px] text-slate-500">{formatFileSize(file.size)}</span>
            </div>
            <Show
              when={file.url}
              fallback={
                <button
                  type="button"
                  data-testid="remote-request-button"
                  class="rounded border border-slate-200 px-2 py-1 text-[11px] hover:bg-slate-50 disabled:opacity-50"
                  disabled={file.downloading}
                  onClick={(): void => props.onRequest(file.id)}
                >
                  {file.downloading ? 'Ждём…' : 'Скачать'}
                </button>
              }
            >
              {(url: Accessor<string>): JSX.Element => (
                <a
                  href={url()}
                  download={file.name}
                  data-testid="remote-download-link"
                  class="rounded border border-slate-200 px-2 py-1 text-[11px] hover:bg-slate-50"
                >
                  Скачать
                </a>
              )}
            </Show>
          </div>
        )}
      </For>
      <Show when={props.files.length === 0}>
        <div class="rounded-lg border border-gray-300 border-dashed bg-gray-50 px-3 py-6 text-center text-slate-500 text-sm">
          Нет файлов
        </div>
      </Show>
    </div>
  </div>
);
