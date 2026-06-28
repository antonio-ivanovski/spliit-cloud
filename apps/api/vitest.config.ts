import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    exclude: ['src/integration/**'],
    setupFiles: ['./src/test/setup-env.ts'],
    environment: 'node',
  },
})
