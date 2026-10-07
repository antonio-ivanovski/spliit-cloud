import {
  PWA_NOTIFICATION_PROTOCOL_VERSION,
  SPLIIT_NOTIFICATION_ACK,
  SPLIIT_NOTIFICATION_NAVIGATE,
  toSameOriginPath,
} from './pwa-notification-protocol'

export type NotificationNavigationDeps = {
  serviceWorker?: Pick<
    ServiceWorkerContainer,
    'addEventListener' | 'removeEventListener'
  >
  navigate: (url: string) => void | Promise<unknown>
  hasBlockers: () => boolean
  getOrigin?: () => string
}

/**
 * Page side of notification navigation: answer worker navigation requests.
 *
 * The router navigates only when safe (no unfinished-work blockers) and only to
 * same-origin paths; otherwise the worker is told the request was blocked and
 * opens another window. Acceptance is acked immediately (not after navigation
 * settles) so the worker beats its 2s fallback clock.
 */
export function startNotificationNavigation(
  deps: NotificationNavigationDeps,
): () => void {
  const container = deps.serviceWorker
  if (!container) return () => {}
  const onMessage = (event: Event) => {
    const message = event as MessageEvent
    const data = message.data as Record<string, unknown> | null
    if (
      !data ||
      typeof data !== 'object' ||
      data.type !== SPLIIT_NOTIFICATION_NAVIGATE ||
      data.protocol !== PWA_NOTIFICATION_PROTOCOL_VERSION
    ) {
      return
    }
    const port = message.ports?.[0]
    const notificationId =
      typeof data.notificationId === 'string' ? data.notificationId : ''
    const respond = (status: 'navigated' | 'blocked') => {
      try {
        port?.postMessage({
          type: SPLIIT_NOTIFICATION_ACK,
          protocol: PWA_NOTIFICATION_PROTOCOL_VERSION,
          notificationId,
          status,
        })
      } catch {
        // A gone worker falls back to opening a window on its own clock.
      }
    }
    const origin =
      deps.getOrigin?.() ??
      (typeof window === 'undefined' ? '' : window.location.origin)
    const url = toSameOriginPath(
      typeof data.url === 'string' ? data.url : '/',
      origin,
    )
    if (deps.hasBlockers()) {
      respond('blocked')
      return
    }
    try {
      const result = deps.navigate(url)
      respond('navigated')
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        void (result as Promise<unknown>).catch(() => {})
      }
    } catch {
      respond('blocked')
    }
  }
  container.addEventListener('message', onMessage as EventListener)
  return () =>
    container.removeEventListener('message', onMessage as EventListener)
}
