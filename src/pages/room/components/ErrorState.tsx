import type { JSX } from 'solid-js';

export function ErrorState(props: {
  title?: string;
  message?: string;
  details?: string;
  onHome?: () => void;
}): JSX.Element {
  return (
    <div class="flex items-center justify-center px-4">
      <section
        class="w-full max-w-lg rounded-2xl border border-rose-200 bg-white/80 p-6 shadow-sm backdrop-blur"
        role="alert"
        aria-live="assertive"
        tabindex={-1}
      >
        <div>
          <div class="mb-1 flex items-start gap-3">
            <div class="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-rose-500" />
            <div class="min-w-0">
              <h1 class="font-semibold text-lg text-slate-900">Something went wrong</h1>
            </div>
          </div>
          <div class="mb-4">
            <p class="mt-1 text-slate-600 text-sm">
              This room is unavailable. Return to the main page and try again.
            </p>
          </div>
        </div>

        {/* Flowbite-like Alert body */}
        <div class="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800 text-sm">
          Error: {props.details}
        </div>

        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700 text-sm hover:cursor-pointer hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300"
            onClick={props.onHome}
          >
            To the main page
          </button>
        </div>
      </section>
    </div>
  );
}
