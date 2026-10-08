/// <reference lib="webworker" />

import { clientsClaim } from 'workbox-core'
import {
  addRoute,
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precache,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

import {
  LOCALE_CHUNK_CACHE_NAME,
  MAX_LOCALE_CHUNK_ENTRIES,
  isLocaleChunkPath,
} from '@/lib/pwa-locale-chunks'
import { APP_SHELL_NAVIGATION_DENYLIST } from '@/lib/pwa-navigation'
import {
  NOTIFICATION_NAV_ACK_TIMEOUT_MS,
  runNotificationClickFlow,
  toSameOriginPath,
  waitForNavigationAck,
} from '@/lib/pwa-notification-protocol'
import {
  coordinatorBeginAttempt,
  coordinatorEndAttempt,
  runCoordinatedActivation,
} from '@/lib/pwa-update-coordinator'
import {
  COORDINATION_RESULT,
  PWA_UPDATE_PROTOCOL_VERSION,
  REQUEST_COORDINATED_ACTIVATION,
} from '@/lib/pwa-update-protocol'
import { locales } from '@spliit/domain/i18n'

declare const self: ServiceWorkerGlobalScope

// Unique per worker instance (a new version is a new global scope), recorded
// by clients alongside their reload authorization so stale confirmations
// cannot authorize an unrelated worker.
const WORKER_INSTANCE_TOKEN =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `worker-${Math.random().toString(36).slice(2)}`

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
// skipWaiting on install — the page reloads after activation so HTML and
// hashed chunks swap together. Activation runs cleanupOutdatedCaches, which
// drops the previous graph: coordinated activation only activates after every
// remaining window client prepares clean and confirms (REQUEST_COORDINATED_
// ACTIVATION); the legacy sole-client request is kept for old pages without
// the protocol. A tab that defers its own reload after another tab activated
// must reload before lazily importing chunks the cleanup may have removed,
// especially offline.
precache(manifest)
cleanupOutdatedCaches()
clientsClaim()

const appShellHandler = createHandlerBoundToURL('/index.html')

// `/` also matches precached index.html. The generic precache route preserves
// the browser's Accept header, which misses HTML cached with Vary: Accept
// (Pages negotiates Markdown in public/_worker.js withMarkdownAlternate).
// Use the bound shell request for these document URLs first, then let the
// precache route handle assets as usual. Keep this handler if the edge ever
// changes Vary/Cache-Control for HTML: the precache lookup must not depend
// on the browser's Accept value.
registerRoute(
  new NavigationRoute(appShellHandler, {
    allowlist: [/^\/(?:index\.html)?(?:$|\?)/],
  }),
)
addRoute()

registerRoute(
  new NavigationRoute(appShellHandler, {
    denylist: [...APP_SHELL_NAVIGATION_DENYLIST],
  }),
)

// On-demand locale chunks (all bundles except en-US/en-GB, excluded from the
// precache in vite.config.ts): cache-first by immutable hashed URL. A chunk
// missing from both cache and network (offline first switch) rejects the
// dynamic import, and i18n/setup.ts falls back to the loaded bundle so the
// screen still renders.
registerRoute(
  ({ url, request }) => {
    if (request.method !== 'GET') return false
    if (new URL(url).origin !== self.location.origin) return false
    return isLocaleChunkPath(new URL(url).pathname, locales)
  },
  async ({ request }) => {
    const cache = await caches.open(LOCALE_CHUNK_CACHE_NAME)
    const hit = await cache.match(request)
    if (hit) return hit
    const response = await fetch(request)
    if (response.ok) {
      try {
        await cache.put(request, response.clone())
        const keys = await cache.keys()
        if (keys.length > MAX_LOCALE_CHUNK_ENTRIES) {
          await Promise.all(
            keys
              .slice(0, keys.length - MAX_LOCALE_CHUNK_ENTRIES)
              .map((key) => cache.delete(key)),
          )
        }
      } catch {
        // Runtime caching is best-effort; the network response still serves.
      }
    }
    return response
  },
)

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    // Legacy pages can only activate when they are the sole window. A stale
    // page must never replace the controller underneath other open windows.
    const sourceClientId =
      event.source && 'id' in event.source ? event.source.id : undefined
    event.waitUntil(
      (async () => {
        const windows = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        })
        if (
          sourceClientId &&
          windows.length === 1 &&
          windows[0]?.id === sourceClientId
        ) {
          await self.skipWaiting()
        }
      })(),
    )
    return
  }

  if (
    event.data &&
    event.data.type === REQUEST_COORDINATED_ACTIVATION &&
    event.data.protocol === PWA_UPDATE_PROTOCOL_VERSION
  ) {
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
        const attemptId =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `attempt-${Date.now()}-${Math.random().toString(36).slice(2)}`
        if (!coordinatorBeginAttempt(attemptId)) {
          respond({
            type: COORDINATION_RESULT,
            protocol: PWA_UPDATE_PROTOCOL_VERSION,
            activated: false,
            reason: 'busy',
            clientCount: 0,
          })
          return
        }
        try {
          const result = await runCoordinatedActivation(
            {
              matchAllWindows: async () => {
                const windows = await self.clients.matchAll({
                  type: 'window',
                  includeUncontrolled: true,
                })
                return windows.map((client) => ({
                  id: client.id,
                  // Port-less broadcast: clients answer by posting directly
                  // to this worker, so no Client transfer support is needed.
                  postMessage: (message: unknown) => {
                    client.postMessage(message)
                  },
                }))
              },
              skipWaiting: () => self.skipWaiting(),
              setTimeout: (fn: () => void, ms: number) =>
                self.setTimeout(fn, ms),
              clearTimeout: (handle: unknown) =>
                self.clearTimeout(handle as number),
              subscribeMessages: (handler) => {
                const listener = (event: ExtendableMessageEvent) => {
                  handler({
                    sourceId:
                      event.source && 'id' in event.source
                        ? (event.source.id as string)
                        : undefined,
                    data: event.data,
                  })
                }
                self.addEventListener('message', listener)
                return () => self.removeEventListener('message', listener)
              },
            },
            {
              attemptId,
              workerToken: WORKER_INSTANCE_TOKEN,
              requesterId:
                typeof sourceClientId === 'string' ? sourceClientId : undefined,
            },
          )
          respond({
            type: COORDINATION_RESULT,
            protocol: PWA_UPDATE_PROTOCOL_VERSION,
            ...result,
          })
        } catch {
          respond({
            type: COORDINATION_RESULT,
            protocol: PWA_UPDATE_PROTOCOL_VERSION,
            activated: false,
            reason: 'activation-failed',
            clientCount: 0,
          })
        } finally {
          coordinatorEndAttempt(attemptId)
        }
      })(),
    )
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
  return toSameOriginPath(value, self.location.origin)
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
  // Never navigate an existing document blindly: focus a window already
  // showing the target, else ask the app to navigate when safe, else open
  // another window (blocked or >2s without ack).
  const notificationId =
    typeof event.notification.tag === 'string' &&
    event.notification.tag.length > 0
      ? event.notification.tag
      : `spliit-${Date.now().toString(36)}`
  event.waitUntil(
    runNotificationClickFlow(
      {
        matchAllWindows: async () => {
          const windows = await self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true,
          })
          return windows.map((client) => ({
            id: client.id,
            url: client.url,
            focus: () =>
              Promise.resolve().then(() =>
                'focus' in client
                  ? (client as WindowClient).focus()
                  : undefined,
              ),
          }))
        },
        openWindow: (url) =>
          self.clients.openWindow(new URL(url, self.location.origin).href),
        requestNavigation: async (clientId, message) => {
          const windows = await self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true,
          })
          const client = windows.find((entry) => entry.id === clientId)
          if (!client) return 'timeout'
          const channel =
            typeof MessageChannel !== 'undefined' ? new MessageChannel() : null
          if (!channel) return 'timeout'
          try {
            client.postMessage(message, [channel.port2])
          } catch {
            return 'timeout'
          }
          return waitForNavigationAck(
            (handler) => {
              channel.port1.onmessage = (portEvent: MessageEvent) =>
                handler(portEvent.data)
              return () => channel.port1.close()
            },
            notificationId,
            { timeoutMs: NOTIFICATION_NAV_ACK_TIMEOUT_MS },
          )
        },
      },
      { targetPath: target, notificationId },
    ).then(
      () => undefined,
      () => undefined,
    ),
  )
})
