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

const buildSha =
  process.env.VITE_BUILD_SHA ?? process.env.CF_PAGES_COMMIT_SHA ?? 'unknown'

export default defineConfig({
  // All workspace apps share the repository-level .env file. Vite otherwise
  // resolves env files relative to apps/web when this task runs via Turbo.
  envDir: path.resolve(import.meta.dirname, '../..'),
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
      injectRegister: false,
      devOptions: { enabled: false },
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: [
        'logo.svg',
        'logo-with-text.svg',
        'favicon/favicon.ico',
        'favicon/apple-touch-icon.png',
      ],
      manifest: {
        id: '/',
        name: 'Spliit Cloud',
        short_name: 'Spliit',
        description: 'Share expenses with friends & family',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        launch_handler: {
          client_mode: 'navigate-existing',
        },
        background_color: '#ffffff',
        theme_color: '#047857',
        lang: 'en',
        dir: 'ltr',
        orientation: 'any',
        display_override: ['standalone'],
        categories: ['finance', 'productivity'],
        prefer_related_applications: false,
        related_applications: [
          {
            platform: 'webapp',
            url: 'https://spliit.cloud/manifest.webmanifest',
          },
        ],
        shortcuts: [
          {
            name: 'Create group',
            short_name: 'New group',
            description: 'Start a new expense sharing group',
            url: '/groups/create',
            icons: [
              {
                src: '/logo-192x192.png',
                sizes: '192x192',
                type: 'image/png',
              },
            ],
          },
          {
            name: 'All expenses',
            short_name: 'Expenses',
            description: 'Browse expenses across all your groups',
            url: '/expenses',
            icons: [
              {
                src: '/logo-192x192.png',
                sizes: '192x192',
                type: 'image/png',
              },
            ],
          },
          {
            name: 'Account settings',
            short_name: 'Settings',
            description: 'Manage your Spliit account and preferences',
            url: '/account/settings',
            icons: [
              {
                src: '/logo-192x192.png',
                sizes: '192x192',
                type: 'image/png',
              },
            ],
          },
        ],
        screenshots: [
          {
            src: '/screenshots/phone-groups-390x844.png',
            sizes: '390x844',
            type: 'image/png',
            form_factor: 'narrow',
            label: 'Spliit group balances on a phone',
          },
          {
            src: '/screenshots/phone-expenses-390x844.png',
            sizes: '390x844',
            type: 'image/png',
            form_factor: 'narrow',
            label: 'Spliit expense list on a phone',
          },
          {
            src: '/screenshots/desktop-overview-1280x720.png',
            sizes: '1280x720',
            type: 'image/png',
            form_factor: 'wide',
            label: 'Spliit group overview on a desktop',
          },
        ],
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
        // Precache one complete Vite graph per deploy. HTML and hashed chunks
        // must switch together so a stale entry point cannot import missing
        // modules. Cloudflare Pages files stay out of the app-shell cache.
        globPatterns: [
          '**/*.{html,js,css,svg,png,ico,webp,woff2,json,webmanifest}',
        ],
        globIgnores: [
          '_worker.js',
          '404.html',
          // Store/install artwork only; not needed to launch the app offline.
          'screenshots/*',
          // ~3 MiB receipt-upload codec; not needed to launch the app offline.
          'assets/heic-to-*.js',
        ],
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
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  define: {
    'import.meta.env.VITE_BUILD_SHA': JSON.stringify(buildSha),
  },
})
