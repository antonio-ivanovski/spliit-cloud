import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
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
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      devOptions: { enabled: false },
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
        // Precache the complete app shell and public branding assets. The
        // receipt scanner is intentionally deferred because this single lazy
        // chunk is roughly 3 MB and is not needed to read cached data.
        globPatterns: [
          '**/*.{html,js,css,svg,png,ico,webp,jpg,jpeg,gif,avif,woff,woff2,json,webmanifest}',
        ],
        globIgnores: ['assets/heic-to-*.js'],
      },
    }),
  ],
  server: {
    port: 3000,
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
