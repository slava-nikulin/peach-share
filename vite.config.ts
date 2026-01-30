import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^argon2id$/, replacement: resolve(rootDir, 'src/argon2id.vite.ts') },
    ],
  },
  server: {
    host: true,
    port: 5173,
    watch: { usePolling: true },
    hmr: { clientPort: 5173 },
    allowedHosts: ['web', 'localhost', '127.0.0.1'],
  },
});
