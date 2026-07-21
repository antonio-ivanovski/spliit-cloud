/// <reference lib="webworker" />

import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

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

// Keep the intentionally conservative PWA cache policy from the generated
// worker. HTML and the hashed application graph remain network-only.
precacheAndRoute(manifest)
cleanupOutdatedCaches()

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
