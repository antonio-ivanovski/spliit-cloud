import react from '@vitejs/plugin-react'
import path from 'node:path'
import svgr from 'vite-plugin-svgr'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), svgr()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/tests/integration/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    restoreMocks: true,
    // Integration tests hit a real API server — run one file at a time
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
