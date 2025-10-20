import type { JSX } from 'solid-js';

export interface DropzoneProps {
  onInputChange: (event: Event) => void;
  onDrop: (event: DragEvent) => void;
  onDragOver: (event: DragEvent) => void;
}

export const Dropzone = (props: DropzoneProps): JSX.Element => {
  let inputRef: HTMLInputElement | undefined;

  const triggerSelect = (): void => {
    inputRef?.click();
  };

  return (
    <div class="rounded-2xl border border-white/70 bg-white/70 p-4 shadow-sm">
      <button
        type="button"
        data-testid="room-dropzone"
        class="flex h-44 w-full flex-col items-center justify-center rounded-xl border-2 border-gray-300 border-dashed bg-gray-50 hover:bg-gray-100 md:h-56"
        onClick={triggerSelect}
        onDrop={props.onDrop}
        onDragOver={props.onDragOver}
      >
        <div class="flex flex-col items-center justify-center pt-5 pb-6 text-center hover:cursor-pointer">
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
            <span class="font-medium">Click</span> to upload
          </p>
          <p class="text-gray-500 text-xs">Or drag files here</p>
        </div>
        <input
          ref={(node: HTMLInputElement | null) => {
            inputRef = node ?? undefined;
          }}
          type="file"
          data-testid="room-file-input"
          class="hidden"
          multiple
          onChange={props.onInputChange}
        />
      </button>
    </div>
  );
};

export const DropOverlay = (): JSX.Element => (
  <div
    data-testid="room-drop-overlay"
    class="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 backdrop-blur-sm transition-opacity duration-150"
  >
    <div class="pointer-events-none rounded-3xl border border-white/40 bg-white/95 px-10 py-8 text-center shadow-2xl shadow-slate-900/20">
      <p class="font-semibold text-slate-900 text-xl">Drop files to share</p>
      <p class="mt-2 text-slate-600 text-sm">Transfers stay private and peer-to-peer.</p>
    </div>
  </div>
);

export const PeerHeaderSimple = (props: {
  label: string;
  count: number;
  you?: boolean;
}): JSX.Element => (
  <div class="flex items-center justify-between border-gray-200 border-b px-4 py-2">
    <div class="flex min-w-0 items-center gap-2">
      <span
        class={`h-2.5 w-2.5 rounded-full ${
          props.you ? 'bg-emerald-500' : 'bg-sky-500'
        } shrink-0 border border-white`}
      />
      <span class="truncate font-medium text-sm">
        {props.label}
        {props.you ? ' (you)' : ''}
      </span>
    </div>
    <span class="rounded-full border border-orange-200 bg-orange-100 px-2 py-0.5 text-[11px] text-orange-800">
      {props.count}
    </span>
  </div>
);

export function formatFileSize(sizeInBytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let size = sizeInBytes;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(1)} ${units[idx]}`;
}
