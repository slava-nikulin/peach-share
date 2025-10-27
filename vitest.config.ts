import { mergeConfig } from 'vite';
import { defineConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globalSetup: ['src/tests/setup/global-testcontainers.ts'],
      projects: [
        {
          extends: true,
          test: {
            name: 'unit',
            include: ['**/*.unit.{test,spec}.ts?(x)'],
            environment: 'node',
          },
        },
        {
          extends: true,
          test: {
            name: 'integration',
            include: ['**/*.int.{test,spec}.ts?(x)'],
            setupFiles: ['src/tests/setup/node-webrtc.ts'],
            environment: 'node',
            testTimeout: 120_000,
            hookTimeout: 120_000,
          },
          ssr: { noExternal: ['wrtc'] },
        },
        {
          extends: true,
          test: {
            name: 'e2e-vitest',
            include: ['**/*.e2e-vitest.{test,spec}.ts?(x)'],
            setupFiles: ['src/tests/setup/node-webrtc.ts'],
            environment: 'node',
            testTimeout: 240_000,
            hookTimeout: 240_000,
          },
          ssr: { noExternal: ['wrtc'] },
        },
      ],
    },
  }),
);
