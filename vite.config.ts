/** biome-ignore-all lint/performance/useTopLevelRegex: this is config */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

const rootDir: string = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const isOfflineMode = mode === 'offline';

  return {
    plugins: [solid(), tailwindcss()],
    define: {
      global: 'globalThis',
    },
    resolve: {
      alias: [
        { find: /^argon2id$/, replacement: resolve(rootDir, 'src/argon2id.vite.ts') },
        { find: /^simple-peer$/, replacement: 'simple-peer/simplepeer.min.js' },
        { find: /^process$/, replacement: 'process/browser' },
        { find: /^util$/, replacement: 'util/' },
      ],
    },
    optimizeDeps: {
      include: ['process/browser', 'util'],
      // Keep cpace-ts as native ESM so wasm URL resolution stays relative to package files.
      exclude: ['cpace-ts', 'cpace-ts/wasm'],
    },
    server: {
      host: true,
      port: 5173,
      watch: { usePolling: true },
      hmr: isOfflineMode ? false : { clientPort: 5173 },
      allowedHosts: ['web', 'localhost', '127.0.0.1'],
    },
  };
});
