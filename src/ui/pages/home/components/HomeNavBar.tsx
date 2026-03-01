import type { JSX } from 'solid-js';

export function HomeNavBar(): JSX.Element {
  return (
    <>
      {import.meta.env.VITE_USE_LOCAL_SECURED_CONTEXT === 'true' && (
        <a
          href="/ca/peachshare-rootCA.crt"
          download=""
          class="me-2 inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-teal-400 via-teal-500 to-lime-400 px-2 py-1.5 text-lg text-white shadow-sm hover:cursor-pointer hover:opacity-90 focus:outline-none focus:ring-4 focus:ring-slate-900/20"
        >
          Download Root CA
        </a>
      )}
    </>
  );
}
