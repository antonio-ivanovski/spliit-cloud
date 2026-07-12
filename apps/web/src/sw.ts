/// <reference lib="webworker" />

import { clientsClaim } from 'workbox-core'
import { ExpirationPlugin } from 'workbox-expiration'
import {
  cleanupOutdatedCaches,
  matchPrecache,
  precacheAndRoute,
} from 'workbox-precaching'
import {
  NavigationRoute,
  registerRoute,
  setCatchHandler,
} from 'workbox-routing'
import { NetworkFirst } from 'workbox-strategies'

declare const self: ServiceWorkerGlobalScope

const navigationStrategy = new NetworkFirst({
  cacheName: 'spliit-pages-v3',
  fetchOptions: { cache: 'no-cache' },
  matchOptions: { ignoreSearch: true },
  networkTimeoutSeconds: 3,
  plugins: [
    {
      // Workbox does not apply fetchOptions to navigation requests. Preserve
      // the network-first update check by setting the request cache mode too.
      requestWillFetch: async ({ request }) =>
        request.mode === 'navigate'
          ? new Request(request, { cache: 'no-cache' })
          : request,
    },
    new ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 7 * 24 * 60 * 60,
      purgeOnQuotaError: true,
    }),
  ],
})

// Register this before the precache route so online navigations always verify
// the current document instead of being served from the precached index.
// API and tRPC paths are intentionally not matched and stay network-only.
registerRoute(
  new NavigationRoute(navigationStrategy, {
    denylist: [/^\/(?:api|trpc)(?:\/|$)/],
  }),
)

// The generated manifest includes the index, route chunks, styles, and the
// public branding assets. The heic scanner chunk is deliberately excluded in
// vite.config.ts because it is too large for the initial offline shell.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Activate a new shell immediately. virtual:pwa-register observes activation
// and reloads controlled tabs when registerType is set to autoUpdate.
self.skipWaiting()
clientsClaim()

setCatchHandler(async ({ request }) => {
  if (request.destination === 'document') {
    return (await matchPrecache('/index.html')) ?? Response.error()
  }

  return Response.error()
})
