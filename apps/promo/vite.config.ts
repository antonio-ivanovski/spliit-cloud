import path from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@web': path.resolve(import.meta.dirname, '../web/src'),
      // Web components retain their own internal imports.
      '@': path.resolve(import.meta.dirname, '../web/src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  plugins: [tailwindcss(), react()],
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
})
