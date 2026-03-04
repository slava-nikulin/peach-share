import { A, type RouteSectionProps, useCurrentMatches } from '@solidjs/router';
import type { Component, ParentComponent } from 'solid-js';
import { createMemo, Show, Suspense } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { AppRouteInfo } from '../router/route-info';

export const RootLayout: ParentComponent<RouteSectionProps> = (props: RouteSectionProps) => {
  const matches = useCurrentMatches();
  const contactEmail = 'vyacheslav.nikulin@gmail.com';

  const NavBar = createMemo<Component | undefined>(() => {
    const ms = matches();
    for (let i = ms.length - 1; i >= 0; i--) {
      const info = ms[i].route.info as AppRouteInfo | undefined;
      if (info?.navBar) return info.navBar;
    }
    return undefined;
  });

  const shouldHideFooter = createMemo<boolean>(() => {
    const ms = matches();
    for (let i = ms.length - 1; i >= 0; i--) {
      const info = ms[i].route.info as AppRouteInfo | undefined;
      if (info?.hideFooter) return true;
    }
    return false;
  });

  return (
    <div class="flex min-h-screen flex-col bg-gradient-to-br from-rose-50 via-orange-50 to-amber-50 text-slate-800">
      <header class="sticky top-0 z-30 border-white/60 border-b bg-white/70 backdrop-blur">
        <nav class="mx-auto flex w-full max-w-[min(92vw,1400px)] items-center justify-between px-4 py-3">
          <A href="/" class="group flex items-center gap-3">
            <span class="h-8 w-8 flex-shrink-0 rounded-2xl border border-orange-300 bg-orange-200 shadow-sm" />

            <div class="flex flex-col">
              <span class="font-semibold text-2xl leading-none tracking-tight">Peach Share</span>
              <p class="mt-1 hidden text-gray-500 text-xs md:block">P2P file sharing via WebRTC</p>
            </div>
          </A>
          <div class="flex items-center gap-2">
            <Suspense fallback={null}>
              <Dynamic component={NavBar()} />
            </Suspense>
          </div>
        </nav>
      </header>

      <main class="mx-auto w-full max-w-[min(92vw,1400px)] flex-1 px-4 py-8">
        <Suspense fallback={null}>{props.children}</Suspense>
      </main>

      <Show when={!shouldHideFooter()}>
        <footer class="border-white/60 border-t bg-white/40">
          <div class="mx-auto flex w-full max-w-[min(92vw,1400px)] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-gray-600 text-xs sm:text-sm">
            <a
              class="hover:text-gray-900 hover:underline"
              href="https://github.com/slava-nikulin/peach-share"
              rel="noopener noreferrer"
              target="_blank"
            >
              Source
            </a>
            <a class="hover:text-gray-900 hover:underline" href={`mailto:${contactEmail}`}>
              Email
            </a>
            <a
              class="hover:text-gray-900 hover:underline"
              href="https://www.notion.so/slava-nikulin/Viacheslav-Nikulin-21c9437d889780918de5d418c479dbee"
              rel="noopener noreferrer"
              target="_blank"
            >
              About me
            </a>
          </div>
        </footer>
      </Show>
    </div>
  );
};
