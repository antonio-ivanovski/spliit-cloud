import { Context, Effect, Layer } from 'effect'

import {
  startNotificationNavigation,
  type NotificationNavigationDeps,
} from '@/lib/pwa-notification-navigation'
import {
  NOTIFICATION_NAV_ACK_TIMEOUT_MS,
  runNotificationClickFlow,
  toSameOriginPath,
  type NotificationClickOutcome,
} from '@/lib/pwa-notification-protocol'

import { createSnapshotBridge, type SnapshotBridge } from './snapshot'

/**
 * Notification navigation service (Task 6).
 *
 * The focus-or-new-window guarantee lives in the worker-safe protocol module
 * (pwa-notification-protocol) and the page ack handler
 * (pwa-notification-navigation) — this service owns their lifetimes and
 * composes them as Effects:
 *
 * - Page side: starts the worker-message subscription on start, removes it on
 *   stop/scope exit. Counts accepted vs refused navigation requests so the UI
 *   can observe without touching the message port.
 * - Worker side (`handleClick`): sanitizes the target to a same-origin path,
 *   focuses an already-target window, otherwise asks one window to navigate
 *   when safe, and opens a fresh window when the page reports blocked or stays
 *   silent past the 2s ack deadline. NEVER blindly navigates an existing
 *   document. Infallible by contract (parity with sw.ts, which swallows click
 *   outcomes): an openWindow throw resolves as opened-fallback — the worker has
 *   no further recourse.
 *
 * Protocol versions, ack validation, and the 2s timeout stay in the protocol
 * module untouched; sw.ts keeps its Workbox routing and event wiring.
 */

export interface PwaNotificationPageSnapshot {
  readonly active: boolean
  readonly accepted: number
  readonly refused: number
}

export const INITIAL_NOTIFICATION_PAGE: PwaNotificationPageSnapshot = {
  active: false,
  accepted: 0,
  refused: 0,
}

export interface PwaNotificationPageDeps {
  readonly serviceWorker?: NotificationNavigationDeps['serviceWorker']
  readonly navigate: (url: string) => void | Promise<unknown>
  readonly hasBlockers?: () => boolean
  readonly getOrigin?: () => string
}

export interface NotificationClickInput {
  /** Raw target URL from the push payload (sanitized to same-origin here). */
  readonly targetUrl: string
  readonly origin: string
  readonly notificationId: string
}

export interface NotificationClickDeps {
  readonly matchAllWindows: () => Promise<
    Array<{
      id: string
      url: string
      focus: () => Promise<unknown>
    }>
  >
  readonly openWindow: (url: string) => Promise<unknown>
  readonly requestNavigation: (
    clientId: string,
    message: Record<string, unknown>,
  ) => Promise<'navigated' | 'blocked' | 'timeout'>
}

export interface PwaNotificationService {
  readonly bridge: SnapshotBridge<PwaNotificationPageSnapshot>
  readonly snapshot: Effect.Effect<PwaNotificationPageSnapshot>
  /** Subscribe to worker navigation requests. Idempotent. */
  readonly start: Effect.Effect<void>
  /** Remove the worker-message subscription. Idempotent. */
  readonly stop: Effect.Effect<void>
  /** Worker-side click flow (per-event scoped Effect in sw.ts). */
  readonly handleClick: (
    input: NotificationClickInput,
    deps: NotificationClickDeps,
  ) => Effect.Effect<NotificationClickOutcome>
}

export const PwaNotificationService = Context.Service<PwaNotificationService>(
  'PwaNotificationService',
)

/** Ack deadline re-export for sw.ts wiring (single owner: protocol module). */
export { NOTIFICATION_NAV_ACK_TIMEOUT_MS }

export function makePwaNotificationService(
  deps: PwaNotificationPageDeps,
): PwaNotificationService {
  const hasBlockers = deps.hasBlockers ?? (() => false)
  let stopSubscription: (() => void) | null = null
  const bridge = createSnapshotBridge(INITIAL_NOTIFICATION_PAGE)

  const start: PwaNotificationService['start'] = Effect.sync(() => {
    if (stopSubscription) return
    const current = bridge.getSnapshot()
    const stop = startNotificationNavigation({
      serviceWorker: deps.serviceWorker,
      navigate: (url) => {
        bridge.publish({
          ...bridge.getSnapshot(),
          accepted: bridge.getSnapshot().accepted + 1,
        })
        return deps.navigate(url)
      },
      hasBlockers: () => {
        const blocked = hasBlockers()
        if (blocked) {
          bridge.publish({
            ...bridge.getSnapshot(),
            refused: bridge.getSnapshot().refused + 1,
          })
        }
        return blocked
      },
      getOrigin: deps.getOrigin,
    })
    stopSubscription = stop
    bridge.publish({ ...current, active: true })
  })

  const stop: PwaNotificationService['stop'] = Effect.sync(() => {
    const release = stopSubscription
    stopSubscription = null
    release?.()
    const current = bridge.getSnapshot()
    bridge.publish({ ...current, active: false })
  })

  const handleClick: PwaNotificationService['handleClick'] = (
    input,
    clickDeps,
  ) =>
    Effect.matchEffect(
      Effect.tryPromise({
        try: (signal) =>
          runNotificationClickFlow(
            {
              matchAllWindows: clickDeps.matchAllWindows,
              openWindow: clickDeps.openWindow,
              requestNavigation: (clientId, message) => {
                if (signal.aborted) return Promise.resolve('timeout' as const)
                return clickDeps.requestNavigation(clientId, message)
              },
            },
            {
              targetPath: toSameOriginPath(input.targetUrl, input.origin),
              notificationId: input.notificationId,
            },
          ),
        catch: (error: unknown) => error,
      }),
      {
        // The worker has no further recourse when opening fails: resolve the
        // best-effort fallback as data instead of rejecting into waitUntil.
        onFailure: () =>
          Effect.succeed({
            handled: 'opened-fallback',
          } as NotificationClickOutcome),
        onSuccess: (outcome) => Effect.succeed(outcome),
      },
    )

  return { bridge, snapshot: bridge.readEffect, start, stop, handleClick }
}

/**
 * Page-scoped notification layer: the worker-message subscription is removed
 * when the scope exits.
 */
export function makePwaNotificationServiceLive(
  deps: PwaNotificationPageDeps,
): Layer.Layer<PwaNotificationService> {
  return Layer.effect(
    PwaNotificationService,
    Effect.acquireRelease(
      Effect.sync(() => makePwaNotificationService(deps)),
      (service) => service.stop,
    ),
  )
}
