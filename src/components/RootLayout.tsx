import { A, type RouteSectionProps } from '@solidjs/router'

export function RootLayout(props: RouteSectionProps) {
  return (
    <div class="min-h-screen bg-gradient-to-br from-rose-50 via-orange-50 to-amber-50 text-slate-800">
      <header class="sticky top-0 z-30 backdrop-blur bg-white/70 border-b border-white/60">
        <nav class="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <A href="/" class="inline-flex items-center gap-2">
            <span class="h-8 w-8 rounded-2xl bg-orange-200 border border-orange-300 shadow-sm" />
            <span class="font-semibold tracking-tight text-2xl">
              Peach Share
            </span>
          </A>
        </nav>
      </header>

      <main class="mx-auto max-w-6xl px-4 py-8">{props.children}</main>
    </div>
  )
}
