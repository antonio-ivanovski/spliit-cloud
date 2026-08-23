import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['src/integration/**/*.test.ts'],
    environment: 'node',
    fileParallelism: true,
    // Integration tests share real services (Postgres, MailDev, MaxIO) with
    // other suites; a single worker keeps their resource use predictable.
    maxWorkers: 1,
  },
})
