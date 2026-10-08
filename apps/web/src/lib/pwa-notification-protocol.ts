/**
 * Versioned notification-navigation protocol (worker-safe).
 *
 * A notification click must never navigate an existing document blindly: the
 * worker focuses a window that already shows the target, otherwise it asks the
 * app to navigate (which replies only when safe: no unfinished-work blockers)
 * and falls back to opening another window when the app reports blocked or
 * stays silent past the ack timeout.
 *
 * Pure decision helpers and the injectable click flow live here so both sides
 * stay testable; `sw.ts` owns the service-worker wiring and the
 * `pwa-notification-navigation` module owns the page side.
 */

export const PWA_NOTIFICATION_PROTOCOL_VERSION = 1

/** Waiting worker -> page: navigate to the notification target. */
export const SPLIIT_NOTIFICATION_NAVIGATE = 'SPLIIT_NOTIFICATION_NAVIGATE'

/** Page -> waiting worker: navigation accepted or refused. */
export const SPLIIT_NOTIFICATION_ACK = 'SPLIIT_NOTIFICATION_ACK'

/** Blocked or silent pages fall back to a fresh window after this long. */
export const NOTIFICATION_NAV_ACK_TIMEOUT_MS = 2000

export type NotificationAckStatus = 'navigated' | 'blocked'

export type NotificationClientSummary = {
  id: string
  url: string
  focused?: boolean
}

/** Same-origin relative path; cross-origin or invalid input becomes '/'. */
export function toSameOriginPath(value: string, origin: string): string {
  try {
    const url = new URL(value, origin)
    return url.origin === origin
      ? `${url.pathname}${url.search}${url.hash}`
      : '/'
  } catch {
    return '/'
  }
}

function targetKey(path: string): string {
  const hashIndex = path.indexOf('#')
  return hashIndex === -1 ? path : path.slice(0, hashIndex)
}

function clientKey(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    return targetKey(`${url.pathname}${url.search}${url.hash}`)
  } catch {
    return null
  }
}

export type NotificationTargetDecision =
  | { action: 'focus'; clientId: string }
  | { action: 'ask'; clientId: string }
  | { action: 'open' }

/**
 * Focus a window already showing the target; otherwise ask one suitable window
 * to navigate; with no windows at all, open the target directly.
 */
export function chooseNotificationClient(
  clients: NotificationClientSummary[],
  targetPath: string,
): NotificationTargetDecision {
  const key = targetKey(targetPath)
  const match = clients.find((client) => clientKey(client.url) === key)
  if (match) return { action: 'focus', clientId: match.id }
  if (clients.length === 0) return { action: 'open' }
  const preferred = clients.find((client) => client.focused) ?? clients[0]
  if (!preferred) return { action: 'open' }
  return { action: 'ask', clientId: preferred.id }
}

/** Validate an inbound navigation ack for one notification. */
export function asNotificationAck(
  data: unknown,
  notificationId: string,
): NotificationAckStatus | null {
  if (typeof data !== 'object' || data === null) return null
  const record = data as Record<string, unknown>
  if (
    record.type !== SPLIIT_NOTIFICATION_ACK ||
    record.protocol !== PWA_NOTIFICATION_PROTOCOL_VERSION ||
    record.notificationId !== notificationId
  ) {
    return null
  }
  if (record.status === 'navigated' || record.status === 'blocked') {
    return record.status
  }
  return null
}

export type NavigationAckSubscribe = (
  handler: (data: unknown) => void,
) => () => void

export type NavigationAckTimers = {
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
}

/**
 * Wait for a page ack on an already-posted navigation request. Resolves
 * 'timeout' when the page stays silent past the ack deadline.
 */
export function waitForNavigationAck(
  subscribe: NavigationAckSubscribe,
  notificationId: string,
  options?: { timeoutMs?: number } & NavigationAckTimers,
): Promise<NotificationAckStatus | 'timeout'> {
  const timeoutMs = options?.timeoutMs ?? NOTIFICATION_NAV_ACK_TIMEOUT_MS
  const schedule: (fn: () => void, ms: number) => unknown =
    options?.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms))
  const cancel: (handle: unknown) => void =
    options?.clearTimeout ??
    ((handle) => globalThis.clearTimeout(handle as never))
  return new Promise((resolve) => {
    let settled = false
    const finish = (status: NotificationAckStatus | 'timeout') => {
      if (settled) return
      settled = true
      cancel(timer)
      unsubscribe()
      resolve(status)
    }
    const timer = schedule(() => finish('timeout'), timeoutMs)
    const unsubscribe = subscribe((data) => {
      const ack = asNotificationAck(data, notificationId)
      if (ack) finish(ack)
    })
  })
}

export type NotificationClickFlowDeps = {
  matchAllWindows: () => Promise<
    Array<NotificationClientSummary & { focus: () => Promise<unknown> }>
  >
  openWindow: (url: string) => Promise<unknown>
  requestNavigation: (
    clientId: string,
    message: Record<string, unknown>,
  ) => Promise<NotificationAckStatus | 'timeout'>
}

export type NotificationClickOutcome =
  | { handled: 'focused' }
  | { handled: 'navigated' }
  | { handled: 'opened' }
  | { handled: 'opened-fallback' }

/**
 * Notification-click flow: focus an already-target window; else ask the app to
 * navigate when safe; on blocked/timeout open another window instead of
 * navigating an existing document blindly.
 */
export async function runNotificationClickFlow(
  deps: NotificationClickFlowDeps,
  input: { targetPath: string; notificationId: string },
): Promise<NotificationClickOutcome> {
  let windows: Awaited<ReturnType<NotificationClickFlowDeps['matchAllWindows']>>
  try {
    windows = await deps.matchAllWindows()
  } catch {
    windows = []
  }
  const decision = chooseNotificationClient(windows, input.targetPath)
  if (decision.action === 'focus') {
    const client = windows.find((entry) => entry.id === decision.clientId)
    try {
      await client?.focus()
    } catch {
      // A gone window falls through to a fresh one below.
      await deps.openWindow(input.targetPath)
      return { handled: 'opened-fallback' }
    }
    return { handled: 'focused' }
  }
  if (decision.action === 'open') {
    await deps.openWindow(input.targetPath)
    return { handled: 'opened' }
  }
  let verdict: NotificationAckStatus | 'timeout'
  try {
    verdict = await deps.requestNavigation(decision.clientId, {
      type: SPLIIT_NOTIFICATION_NAVIGATE,
      protocol: PWA_NOTIFICATION_PROTOCOL_VERSION,
      url: input.targetPath,
      notificationId: input.notificationId,
    })
  } catch {
    verdict = 'timeout'
  }
  if (verdict === 'navigated') return { handled: 'navigated' }
  await deps.openWindow(input.targetPath)
  return { handled: 'opened-fallback' }
}
