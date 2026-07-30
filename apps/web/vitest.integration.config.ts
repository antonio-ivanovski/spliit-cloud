import path from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['src/tests/integration/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.dom.ts'],
    css: false,
    restoreMocks: true,
    fileParallelism: true,
    maxWorkers: 2,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
