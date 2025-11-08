import { A, type RouteSectionProps } from '@solidjs/router';
import type { ParentComponent } from 'solid-js';
import { useNavActions } from './nav-actions';

export const RootLayout: ParentComponent<RouteSectionProps> = (props: RouteSectionProps) => {
  const { navActions } = useNavActions();

  return (
    <div class="min-h-screen bg-gradient-to-br from-rose-50 via-orange-50 to-amber-50 text-slate-800">
      <header class="sticky top-0 z-30 border-white/60 border-b bg-white/70 backdrop-blur">
        <nav class="mx-auto flex w-full max-w-[min(92vw,1400px)] items-center justify-between px-4 py-3">
          <A href="/" class="inline-flex items-center gap-2">
            <span class="h-8 w-8 rounded-2xl border border-orange-300 bg-orange-200 shadow-sm" />
            <span class="font-semibold text-2xl tracking-tight">Peach Share</span>
          </A>
          <div class="flex items-center gap-2">
            {navActions() /* сюда страница «вкладывает» кнопки */}
          </div>
        </nav>
      </header>

      <main class="mx-auto w-full max-w-[min(92vw,1400px)] px-4 py-8">{props.children}</main>
    </div>
  );
};
