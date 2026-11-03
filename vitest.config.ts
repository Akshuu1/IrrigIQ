import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
    fileParallelism: false,
    maxWorkers: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        'packages/shared/src/science.ts': {
          lines: 95,
          functions: 95,
          branches: 95,
          statements: 95,
        },
        'apps/api/src/services/**': {
          lines: 80,
          statements: 80,
        },
      },
    },
  },
});
