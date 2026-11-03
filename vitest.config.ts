import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
    fileParallelism: false,
    maxWorkers: 1,
  },
});
