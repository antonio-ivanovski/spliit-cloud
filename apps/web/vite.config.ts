import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

import { APP_VERSION } from './src/generated/app-version.js'
import { buildLocaleChunkIgnores } from './src/lib/pwa-locale-chunks.js'

const appBuild = {
  buildId: process.env.SPLIIT_BUILD_ID || randomUUID(),
  version: APP_VERSION,
}

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

/** Locale codes from src/messages/*.json (node-side, build time only). */
function readMessageLocales(): string[] {
  const dir = path.resolve(import.meta.dirname, './src/messages')
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -'.json'.length))
}

export default defineConfig({
  define: { __APP_BUILD__: JSON.stringify(appBuild) },
  // All workspace apps share the repository-level .env file. Vite otherwise
  // resolves env files relative to apps/web when this task runs via Turbo.
  envDir: path.resolve(import.meta.dirname, '../..'),
  plugins: [
    {
      name: 'spliit-build-info',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify(appBuild),
        })
      },
    },
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
        'app-icon-180.png',
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
        // Web Share Target (issue #159): lets Android share sheets offer
        // Spliit for receipt files and shared text. Files arrive as a
        // multipart POST staged by the service worker (see sw.ts), which
        // 303-redirects to the hidden /share-target/ page; text shares
        // travel the same path. The accept list mirrors
        // RECEIPT_SCAN_MIME_TYPES in packages/domain/src/expense-documents.ts
        // (text/plain doubles as the shared-text transport).
        share_target: {
          action: '/share-target/',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            files: [
              {
                name: 'receipts',
                accept: [
                  'image/jpeg',
                  'image/png',
                  'image/webp',
                  'image/heic',
                  'image/heif',
                  'application/pdf',
                  'text/plain',
                  'text/csv',
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  'application/vnd.oasis.opendocument.text',
                ],
              },
            ],
          },
        },
        background_color: '#ffffff',
        theme_color: '#ffffff',
        lang: 'en',
        dir: 'ltr',
        orientation: 'any',
        display_override: ['standalone'],
        categories: ['finance', 'productivity'],
        prefer_related_applications: false,
        related_applications: [
          {
            platform: 'play',
            id: 'cloud.spliit.twa',
            url: 'https://play.google.com/store/apps/details?id=cloud.spliit.twa',
          },
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
                src: '/app-icon-192.png',
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
                src: '/app-icon-192.png',
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
                src: '/app-icon-192.png',
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
            src: '/app-icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/app-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/app-icon-512-maskable.png',
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
          'version.json',
          '_worker.js',
          '404.html',
          // Store/install artwork only; not needed to launch the app offline.
          'screenshots/*',
          // Native update discovery must not be frozen in an app-shell precache.
          'android/releases/*',
          // ~3 MiB receipt-upload codec; not needed to launch the app offline.
          'assets/heic-to-*.js',
          // Locale bundles (~7 MB for all 32): only the default bundle and
          // its overlay stay precached. The rest load on demand into the
          // service worker's runtime cache (see sw.ts); the list derives
          // from messages/*.json so new locales are excluded automatically.
          ...buildLocaleChunkIgnores(readMessageLocales()),
        ],
      },
    }),
  ],
  server: {
    // Portless assigns the app port via PORT; fall back to the PORTLESS=0
    // bypass port when PORT is unset. strictPort keeps a collision loud
    // instead of silently shifting to a port the proxy does not route to.
    host: '127.0.0.1',
    port: Number(process.env.PORT || 3000),
    strictPort: true,
    allowedHosts: publicWebHosts,
  },
  preview: {
    // Keep preview off the dev port and on its own portless name
    // (https://preview.spliit.localhost): a production service worker
    // persists at the origin scope, so sharing the dev origin lets a
    // previewed build keep serving its precache to dev pages (most visibly
    // in Firefox on localhost:3000).
    host: '127.0.0.1',
    port: Number(process.env.PORT || 4173),
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
