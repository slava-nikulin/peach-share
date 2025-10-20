import { For, type JSX, Show } from 'solid-js';
import { formatFileSize } from './DropZone';
import type { FileMeta } from './state';

export const MyFileList = (props: {
  files: FileMeta[];
  onRemove: (id: string) => void;
}): JSX.Element => (
  <div class="p-2">
    <div class="max-h-56 space-y-1.5 overflow-y-auto">
      <For each={props.files}>
        {(file: FileMeta): JSX.Element => (
          <div
            data-testid="local-file-row"
            data-file-id={file.id}
            data-file-name={file.name}
            class="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 hover:bg-gray-50"
          >
            <div class="flex min-w-0 flex-1 items-center gap-2">
              <p class="truncate text-slate-800 text-sm">{file.name}</p>
              <span class="shrink-0 text-[11px] text-slate-500">{formatFileSize(file.size)}</span>
            </div>
            <button
              type="button"
              data-testid="local-remove-button"
              class="rounded border border-rose-200 px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-50"
              onClick={(): void => props.onRemove(file.id)}
            >
              Удалить
            </button>
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
