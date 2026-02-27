import { mergeConfig, type UserConfig, type UserConfigExport } from 'vite';
import { defineConfig } from 'vitest/config';
import viteConfig from './vite.config';

function resolveViteConfig(config: UserConfigExport, mode: string): UserConfig | Promise<UserConfig> {
  if (typeof config === 'function') {
    return config({
      command: 'serve',
      mode,
      isSsrBuild: false,
      isPreview: false,
    });
  }

  return config;
}

export default defineConfig(async ({ mode }) => {
  const baseViteConfig = (await resolveViteConfig(viteConfig, mode)) as UserConfig;

  return mergeConfig(baseViteConfig, {
    test: {
      globals: true,
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
            globalSetup: ['src/tests/setup/integration-testcontainers.ts'],
            include: ['**/*.int.{test,spec}.ts?(x)'],
            setupFiles: [
              'src/tests/setup/node-webrtc.ts',
              'src/tests/setup/integration-firebase.ts',
              'src/tests/setup/integration-drand-mock.ts',
            ],
            environment: 'node',
            testTimeout: 120_000,
            hookTimeout: 120_000,
            poolOptions: {
              threads: {
                singleThread: true,
              },
            },
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
  });
});
