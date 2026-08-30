/// <reference lib="webworker" />

import { clientsClaim } from 'workbox-core'
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

import { APP_SHELL_NAVIGATION_DENYLIST } from '@/lib/pwa-navigation'

declare const self: ServiceWorkerGlobalScope

type PushPayload = {
  version: 1
  kind: string
  title: string
  body: string
  url: string
  tag?: string
}

const manifest = self.__WB_MANIFEST

// Atomic app shell: this worker's precache is one Vite graph. Do not
// skipWaiting on install — the page reloads after SKIP_WAITING so HTML and
// hashed chunks swap together. cleanupOutdatedCaches then drops the previous
// graph only after that reload.
precacheAndRoute(manifest)
cleanupOutdatedCaches()
clientsClaim()

registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [...APP_SHELL_NAVIGATION_DENYLIST],
  }),
)

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting())
    return
  }

  if (event.data && event.data.type === 'ACTIVATE_UPDATE_IF_SOLE_CLIENT') {
    const responsePort = event.ports[0]
    if (!responsePort) return
    const sourceClientId =
      event.source && 'id' in event.source ? event.source.id : undefined
    const respond = (data: object) => {
      try {
        responsePort.postMessage(data)
      } catch {
        // The requesting document may have closed or timed out.
      }
    }
    event.waitUntil(
      (async () => {
        try {
          const windows = await self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true,
          })
          // If the requesting window closed during the check, another window
          // must not accidentally become the sole client and get restarted.
          if (
            !sourceClientId ||
            !windows.some((client) => client.id === sourceClientId)
          ) {
            respond({ status: 'error' })
            return
          }
          if (windows.length > 1) {
            respond({
              status: 'blocked',
              clientCount: windows.length,
            })
            return
          }
          await self.skipWaiting()
          respond({ status: 'accepted' })
        } catch {
          respond({ status: 'error' })
        }
      })(),
    )
  }
})

function parsePayload(data: PushMessageData | null): PushPayload | null {
  if (!data) return null
  try {
    const value = data.json() as Partial<PushPayload>
    if (
      value.version !== 1 ||
      typeof value.kind !== 'string' ||
      typeof value.title !== 'string' ||
      typeof value.body !== 'string' ||
      typeof value.url !== 'string'
    ) {
      return null
    }
    return value as PushPayload
  } catch {
    return null
  }
}

function safeUrl(value: string): string {
  try {
    const url = new URL(value, self.location.origin)
    return url.origin === self.location.origin
      ? `${url.pathname}${url.search}${url.hash}`
      : '/'
  } catch {
    return '/'
  }
}

self.addEventListener('push', (event) => {
  const payload = parsePayload(event.data)
  if (!payload) return

  const url = safeUrl(payload.url)
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/logo-192x192.png',
      badge: '/logo-192x192.png',
      tag: payload.tag ?? `spliit-${payload.kind}`,
      data: { url },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = safeUrl(
    typeof event.notification.data?.url === 'string'
      ? event.notification.data.url
      : '/',
  )
  const absoluteTarget = new URL(target, self.location.origin).href

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      const existing = windows.find((client): client is WindowClient =>
        client.url.startsWith(self.location.origin),
      )
      if (existing) {
        await existing.navigate(absoluteTarget)
        await existing.focus()
        return
      }
      await self.clients.openWindow(absoluteTarget)
    })(),
  )
})
