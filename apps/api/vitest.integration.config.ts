import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['src/integration/**/*.test.ts'],
    setupFiles: ['./src/test/setup-env.ts'],
    environment: 'node',
    // Integration tests rely on a real PostgreSQL — run one file at
    // a time to avoid DB-level contention on the shared schema.
    fileParallelism: false,
  },
})
