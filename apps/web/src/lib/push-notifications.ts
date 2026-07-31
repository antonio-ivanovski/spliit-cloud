export type PushSubscriptionJSON = {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export function isIosHomeScreenRequired(): boolean {
  if (typeof navigator === 'undefined') return false
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const isStandalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    ('standalone' in navigator &&
      (navigator as Navigator & { standalone?: boolean }).standalone === true)
  return isIos && !isStandalone
}

function decodeBase64Url(value: string): ArrayBuffer {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  return Uint8Array.from(raw, (character) => character.charCodeAt(0))
    .buffer as ArrayBuffer
}

export async function getPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

export async function subscribeToPush(
  applicationServerKey: string,
): Promise<PushSubscription> {
  if (!isPushSupported()) throw new Error('Push notifications are unsupported')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Push permission was denied')

  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeBase64Url(applicationServerKey),
  })
}

export function serializePushSubscription(
  subscription: PushSubscription,
): PushSubscriptionJSON {
  const keys = subscription.toJSON().keys
  if (!keys?.p256dh || !keys.auth) {
    throw new Error('Push subscription is missing encryption keys')
  }
  return {
    endpoint: subscription.endpoint,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
  }
}

/**
 * Disconnect the browser subscription during logout; server cleanup is best
 * effort.
 */
export async function disconnectPushSubscription(): Promise<boolean> {
  try {
    const subscription = await getPushSubscription()
    if (!subscription) return false

    // Keep logout usable in lightweight surfaces that do not mount the tRPC
    // React provider (for example the account menu tests). The request uses
    // the same batch JSON shape as httpBatchLink and remains authenticated by
    // the existing session cookie.
    await fetch(`${getApiBaseUrl()}/trpc/notifications.push.remove?batch=1`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([{ json: { endpoint: subscription.endpoint } }]),
    }).catch(() => undefined)
    await subscription.unsubscribe().catch(() => undefined)
    return true
  } catch {
    // Logout must complete even if a browser has already discarded its endpoint.
    return false
  }
}
import { getApiBaseUrl } from './api-url'
