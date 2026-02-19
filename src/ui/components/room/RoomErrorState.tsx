import type { JSX } from 'solid-js';

export function RoomErrorState(props: { title: string; message: string }): JSX.Element {
  return (
    <div class="flex items-center justify-center">
      <section
        class="w-full max-w-lg rounded-2xl border border-rose-200 bg-white/80 p-6 shadow-sm backdrop-blur"
        role="alert"
        aria-live="assertive"
        tabindex={-1}
        data-testid="room-error"
      >
        <div class="mb-4">
          <div class="mb-1 flex items-start gap-3">
            <div class="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-rose-500" />
            <div class="min-w-0">
              <h1 class="font-semibold text-lg text-slate-900" data-testid="room-error-title">
                {props.title}
              </h1>
            </div>
          </div>

          <p class="mt-1 text-slate-600 text-sm" data-testid="room-error-message">
            {props.message}
          </p>
        </div>

        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700 text-sm hover:cursor-pointer hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300"
          >
            To the main page
          </button>
        </div>
      </section>
    </div>
  );
}
