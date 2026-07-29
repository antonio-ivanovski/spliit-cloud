import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['src/integration/**/*.test.ts'],
    environment: 'node',
    fileParallelism: true,
    maxWorkers: 4,
  },
})
