import { A, type RouteSectionProps } from '@solidjs/router'

export function RootLayout(props: RouteSectionProps) {
  return (
    <div class="min-h-screen bg-gradient-to-br from-rose-50 via-orange-50 to-amber-50 text-slate-800">
      <header class="sticky top-0 z-30 backdrop-blur bg-white/70 border-b border-white/60">
        <div class="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <A href="/" class="inline-flex items-center gap-2">
            <span class="h-8 w-8 rounded-2xl bg-orange-200 border border-orange-300 shadow-sm" />
            <span class="font-semibold tracking-tight">PeachShare</span>
          </A>
          <nav class="hidden sm:flex items-center gap-4 text-sm">
            <A href="/" class="hover:underline underline-offset-4">
              Главная
            </A>
            <span class="text-slate-400">v0.1</span>
          </nav>
        </div>
      </header>

      <main class="mx-auto max-w-6xl px-4 py-8">
        <div class="grid grid-cols-1 md:grid-cols-[260px,1fr] gap-6">
          <aside class="hidden md:block">
            <div class="rounded-2xl border border-white/70 bg-white/60 p-4 shadow-sm">
              <div class="text-sm font-semibold mb-2">Инструкция</div>
              <ol class="list-decimal ml-5 space-y-1 text-sm text-slate-700">
                <li>Подключите устройства к одному Wi-Fi.</li>
                <li>Создайте комнату на одном устройстве.</li>
                <li>Подключитесь с другого по коду/QR.</li>
                <li>Обмен файлами — на следующем шаге.</li>
              </ol>
            </div>
          </aside>
          <section class="min-h-[60vh]">{props.children}</section>
        </div>
      </main>

      <footer class="border-t border-white/60">
        <div class="mx-auto max-w-6xl px-4 py-6 text-xs text-slate-500">
          © PeachShare · Учебный прототип UI
        </div>
      </footer>
    </div>
  )
}
