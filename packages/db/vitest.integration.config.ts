import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    maxWorkers: 1,
    testTimeout: 120000,
  },
})
