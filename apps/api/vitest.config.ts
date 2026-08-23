import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['src/integration/**'],
    environment: 'node',
    // Several package test tasks run concurrently under turbo; uncapped forks
    // oversubscribe the CPU and starve every suite (timeouts under load).
    maxWorkers: 2,
  },
})
