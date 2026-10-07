import { Context, Effect, Layer } from 'effect'

import { CapabilityError, PermissionError } from './errors'
import { createSnapshotBridge, type SnapshotBridge } from './snapshot'

/**
 * Push notification lifecycle service (Task 7).
 *
 * Capability detection, permission, browser subscription, server
 * registration/removal, and sign-out cleanup extracted from the push hooks.
 * Components keep presentation and dispatch; this service owns Effect
 * composition:
 *
 * - Capability first: unsupported engines fail CapabilityError before any browser
 *   API is touched. No indefinite serviceWorker.ready wait — the injected
 *   getRegistration resolves either way (a worker-less host resolves null and
 *   maps to CapabilityError instead of hanging logout).
 * - Permission boundary: a denied permission fails PermissionError without
 *   prompting again. The request itself runs inside enable, which callers
 *   dispatch from a user gesture (transient activation covers the deferred
 *   request); the service never schedules permission outside enable.
 * - Server registration/removal are best-effort outcomes, not failures: enable
 *   reports {enabled:false, reason:'server-error'} when the row write fails so
 *   the UI can retry; disable/disconnect always settle locally.
 * - Sign-out cleanup (disconnectForSignOut) never fails: server removal and local
 *   unsubscribe both best-effort, logout always completes.
 */

export type PushPermissionState =
  | 'granted'
  | 'denied'
  | 'default'
  | 'unsupported'

export interface PushSnapshot {
  readonly supported: boolean
  readonly permission: PushPermissionState
  readonly endpoint: string | null
  readonly serverRegistered: boolean
  readonly lastErrorAt: number | null
}

export const INITIAL_PUSH: PushSnapshot = {
  supported: false,
  permission: 'unsupported',
  endpoint: null,
  serverRegistered: false,
  lastErrorAt: null,
}

export type PushFailure = CapabilityError | PermissionError

export type EnableOutcome =
  | { readonly enabled: true }
  | { readonly enabled: false; readonly reason: 'server-error' }

export interface PushSubscriptionRecord {
  readonly endpoint: string
  readonly keys: { readonly p256dh: string; readonly auth: string }
  readonly unsubscribe: () => Promise<unknown>
}

export interface PushServiceDeps {
  readonly isSupported?: () => boolean
  readonly getPermission?: () => PushPermissionState
  readonly requestPermission?: () => Promise<PushPermissionState>
  /** Resolves null when no worker is registered (never serviceWorker.ready). */
  readonly getRegistration?: () => Promise<unknown>
  readonly getSubscription?: () => Promise<PushSubscriptionRecord | null>
  readonly subscribe?: (
    vapidPublicKey: string,
    signal: AbortSignal,
  ) => Promise<PushSubscriptionRecord>
  readonly registerOnServer?: (
    subscription: {
      readonly endpoint: string
      readonly keys: { readonly p256dh: string; readonly auth: string }
    },
    signal: AbortSignal,
  ) => Promise<void>
  readonly removeFromServer?: (
    endpoint: string,
    signal: AbortSignal,
  ) => Promise<void>
  readonly now?: () => number
}

export interface PushService {
  readonly bridge: SnapshotBridge<PushSnapshot>
  readonly snapshot: Effect.Effect<PushSnapshot>
  /** Refresh local subscription state into the snapshot. Never fails. */
  readonly refresh: Effect.Effect<void>
  /**
   * Enable push: capability -> permission -> subscribe -> server register.
   * Dispatch from a user gesture. Server failure reports an outcome.
   */
  readonly enable: (
    vapidPublicKey: string,
  ) => Effect.Effect<EnableOutcome, PushFailure>
  /** Disable push: server removal best-effort, local unsubscribe settles. */
  readonly disable: Effect.Effect<void>
  /** Sign-out cleanup: best-effort everything, never fails. */
  readonly disconnectForSignOut: Effect.Effect<boolean>
}

export const PushService = Context.Service<PushService>('PushService')

export function makePushService(deps?: PushServiceDeps): PushService {
  const isSupported = deps?.isSupported ?? defaultSupported
  const getPermission = deps?.getPermission ?? defaultPermission
  const requestPermission = deps?.requestPermission ?? defaultRequestPermission
  const getRegistration = deps?.getRegistration ?? (() => Promise.resolve(null))
  const getSubscription = deps?.getSubscription ?? (() => Promise.resolve(null))
  const subscribe =
    deps?.subscribe ??
    (() =>
      Promise.reject(new CapabilityError({ capability: 'push-subscribe' })))
  const registerOnServer = deps?.registerOnServer ?? (() => Promise.resolve())
  const removeFromServer = deps?.removeFromServer ?? (() => Promise.resolve())
  const now = deps?.now ?? (() => Date.now())

  const bridge = createSnapshotBridge(INITIAL_PUSH)

  const publish = (patch: Partial<PushSnapshot>): void => {
    bridge.publish({ ...bridge.getSnapshot(), ...patch })
  }

  const refresh: PushService['refresh'] = Effect.matchEffect(
    Effect.tryPromise({
      try: async () => {
        if (!isSupported()) return null
        return getSubscription()
      },
      catch: (error: unknown) => error,
    }),
    {
      onFailure: () =>
        Effect.sync(() => {
          publish({ supported: isSupported(), lastErrorAt: now() })
        }),
      onSuccess: (subscription) =>
        Effect.sync(() => {
          const supported = isSupported()
          publish({
            supported,
            permission: supported ? getPermission() : 'unsupported',
            endpoint: subscription?.endpoint ?? null,
          })
        }),
    },
  )

  const enable: PushService['enable'] = (vapidPublicKey) =>
    Effect.gen(function* () {
      if (!isSupported()) {
        publish({ supported: false, permission: 'unsupported' })
        return yield* Effect.fail(
          new CapabilityError({ capability: 'push-notifications' }),
        )
      }
      publish({ supported: true, permission: getPermission() })
      let permission = getPermission()
      if (permission === 'denied') {
        return yield* Effect.fail(
          new PermissionError({ permission: 'notifications' }),
        )
      }
      if (permission !== 'granted') {
        // tryPromise (not promise): a throwing host is a denied-equivalent
        // outcome, never a defect.
        const requested = yield* Effect.matchEffect(
          Effect.tryPromise({
            try: () => requestPermission(),
            catch: (error: unknown) => error,
          }),
          {
            onFailure: () => Effect.succeed('denied' as PushPermissionState),
            onSuccess: (state) => Effect.succeed(state),
          },
        )
        permission = requested
        publish({ permission })
        if (permission !== 'granted') {
          return yield* Effect.fail(
            new PermissionError({ permission: 'notifications' }),
          )
        }
      }
      const registration = yield* Effect.tryPromise({
        try: () => getRegistration(),
        catch: (error: unknown) => error,
      }).pipe(
        Effect.matchEffect({
          onFailure: () => Effect.succeed(null),
          onSuccess: (value) => Effect.succeed(value),
        }),
      )
      if (!registration) {
        return yield* Effect.fail(
          new CapabilityError({ capability: 'push-registration' }),
        )
      }
      const subscription = yield* Effect.tryPromise({
        try: (signal) => subscribe(vapidPublicKey, signal),
        catch: (error: unknown) => error,
      }).pipe(
        Effect.matchEffect({
          onFailure: (error: unknown): Effect.Effect<never, PushFailure> => {
            if (isPermissionDenial(error)) {
              return Effect.fail(
                new PermissionError({ permission: 'notifications' }),
              )
            }
            return Effect.fail(
              new CapabilityError({ capability: 'push-subscribe' }),
            )
          },
          onSuccess: (value) => Effect.succeed(value),
        }),
      )
      publish({ endpoint: subscription.endpoint })
      const registered = yield* Effect.matchEffect(
        Effect.tryPromise({
          try: (signal) =>
            registerOnServer(
              {
                endpoint: subscription.endpoint,
                keys: subscription.keys,
              },
              signal,
            ),
          catch: (error: unknown) => error,
        }),
        {
          onFailure: () => Effect.succeed(false),
          onSuccess: () => Effect.succeed(true),
        },
      )
      publish({
        serverRegistered: registered,
        lastErrorAt: registered ? bridge.getSnapshot().lastErrorAt : now(),
      })
      if (!registered)
        return { enabled: false as const, reason: 'server-error' as const }
      return { enabled: true as const }
    })

  const removeServerRow = (endpoint: string | null) =>
    Effect.ignore(
      Effect.tryPromise({
        try: (signal) =>
          endpoint ? removeFromServer(endpoint, signal) : Promise.resolve(),
        catch: (error: unknown) => error,
      }),
    )

  const disable: PushService['disable'] = Effect.gen(function* () {
    const endpoint = bridge.getSnapshot().endpoint
    yield* removeServerRow(endpoint)
    yield* Effect.ignore(
      Effect.tryPromise({
        try: async () => {
          const current = await getSubscription().catch(() => null)
          await current?.unsubscribe().catch(() => undefined)
        },
        catch: (error: unknown) => error,
      }),
    )
    publish({ endpoint: null, serverRegistered: false })
  })

  const disconnectForSignOut: PushService['disconnectForSignOut'] =
    Effect.matchEffect(
      Effect.gen(function* () {
        const current = yield* Effect.tryPromise({
          try: () => getSubscription(),
          catch: (error: unknown) => error,
        }).pipe(
          Effect.matchEffect({
            onFailure: () =>
              Effect.succeed(null as PushSubscriptionRecord | null),
            onSuccess: (value) => Effect.succeed(value),
          }),
        )
        if (!current) return false
        yield* removeServerRow(current.endpoint)
        yield* Effect.ignore(
          Effect.tryPromise({
            try: () => current.unsubscribe(),
            catch: (error: unknown) => error,
          }),
        )
        const snapshot = bridge.getSnapshot()
        if (snapshot.endpoint === current.endpoint) {
          publish({ endpoint: null, serverRegistered: false })
        }
        return true
      }),
      {
        // Logout always completes, even when the browser discarded state.
        onFailure: () => Effect.succeed(false),
        onSuccess: (value) => Effect.succeed(value),
      },
    )

  return {
    bridge,
    snapshot: bridge.readEffect,
    refresh,
    enable,
    disable,
    disconnectForSignOut,
  }
}

function isPermissionDenial(error: unknown): boolean {
  if (error instanceof PermissionError) return true
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''
  return /denied|permission/i.test(message)
}

function defaultSupported(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      window.isSecureContext &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    )
  } catch {
    return false
  }
}

function defaultPermission(): PushPermissionState {
  try {
    if (typeof Notification === 'undefined') return 'unsupported'
    const permission = Notification.permission
    return permission === 'granted' ||
      permission === 'denied' ||
      permission === 'default'
      ? permission
      : 'unsupported'
  } catch {
    return 'unsupported'
  }
}

function defaultRequestPermission(): Promise<PushPermissionState> {
  try {
    return Notification.requestPermission() as Promise<PushPermissionState>
  } catch {
    return Promise.resolve('denied')
  }
}

export function makePushServiceLive(
  deps?: PushServiceDeps,
): Layer.Layer<PushService> {
  return Layer.succeed(PushService, makePushService(deps))
}
