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
      workbox: {
        // Keep the document out of precache. It is the deployment/version
        // pointer for the hashed module graph and must always be resolved by
        // the network-first navigation route below.
        globPatterns: ['**/*.{svg,png,ico,webp}'],
        // Receipt-scanning chunk is ~3MB and lazy-loaded; defer offline
        // support for it until full offline mode is in scope.
        navigateFallbackDenylist: [/^\/(?:api|trpc|auth)(?:\/|$)/],
        // Let the network/CDN serve Vite's hashed module graph. Precaching
        // chunks can leave an active service worker in charge of URLs from a
        // different build during deploys or updates.
        globIgnores: ['assets/**/*'],
        // The runtime navigation route below must be the first responder so
        // online launches always verify the current document. A generated
        // NavigationRoute would otherwise serve the precached index.html.
        navigateFallback: null,
        // Keep the app shell available for short, best-effort offline reads.
        // NetworkFirst means a deployment is picked up on every online load;
        // Cache Storage is only a bounded fallback when the network is down.
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) =>
              request.mode === 'navigate' &&
              url.origin === location.origin &&
              !/^\/(?:api|trpc|auth)(?:\/|$)/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'spliit-pages-v2',
              fetchOptions: { cache: 'no-cache' },
              // The recovery reload adds a one-shot query marker. HTML is a
              // shell, so search params must not prevent its cached fallback.
              matchOptions: { ignoreSearch: true },
              cacheableResponse: { statuses: [200] },
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 7 * 24 * 60 * 60,
                purgeOnQuotaError: true,
              },
            },
          },
          {
            urlPattern: ({ request, url }) =>
              url.origin === location.origin &&
              url.pathname.startsWith('/assets/') &&
              /\.(?:js|css)$/.test(url.pathname) &&
              !/^\/(?:api|trpc|auth)(?:\/|$)/.test(url.pathname) &&
              (request.destination === 'script' ||
                request.destination === 'style'),
            // Vite's production assets are content-hashed. Once one has
            // loaded successfully it is safe to serve it from Cache Storage
            // for a short offline window; a new document points at new URLs.
            handler: 'CacheFirst',
            options: {
              cacheName: 'spliit-code-v2',
              cacheableResponse: { statuses: [200] },
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 7 * 24 * 60 * 60,
                purgeOnQuotaError: true,
              },
            },
          },
        ],
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
