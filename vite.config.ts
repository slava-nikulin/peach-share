import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    watch: { usePolling: true },
    hmr: { clientPort: 5173 },
    allowedHosts: ['web', 'localhost', '127.0.0.1'],
  },
});
