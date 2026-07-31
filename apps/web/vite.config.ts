import path from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const publicWebHosts = (process.env.WEB_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
  .flatMap((origin) => {
    try {
      const hostname = new URL(origin).hostname
      return hostname === 'localhost' || hostname === '127.0.0.1'
        ? []
        : [hostname]
    } catch {
      return []
    }
  })

export default defineConfig({
  // All workspace apps share the repository-level .env file. Vite otherwise
  // resolves env files relative to apps/web when this task runs via Turbo.
  envDir: path.resolve(__dirname, '../..'),
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
    }),
    tailwindcss(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: false },
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: [
        'logo.svg',
        'logo-with-text.svg',
        'logo-with-text.webp',
        'logo.webp',
        'favicon/favicon.ico',
        'favicon/apple-touch-icon.png',
      ],
      manifest: {
        name: 'Spliit Cloud',
        short_name: 'Spliit',
        description: 'Share expenses with friends & family',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#047857',
        lang: 'en',
        icons: [
          {
            src: '/logo-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/logo-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/logo-512x512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        // Keep only version-independent public media in the interim worker.
        // HTML and Vite's hashed module graph must always come from the network
        // so a stale entry point cannot reference a different deployment.
        globPatterns: ['**/*.{svg,png,ico,webp}'],
        globIgnores: ['assets/**/*'],
      },
    }),
  ],
  server: {
    port: 3000,
    allowedHosts: publicWebHosts,
  },
  preview: {
    port: 3000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
