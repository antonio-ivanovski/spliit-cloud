import { Effect } from 'effect'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  getPushRegistration,
  getPushSubscription,
  isIosHomeScreenRequired,
  isPushSupported,
  serializePushSubscription,
  subscribeToPush,
} from '@/lib/push-notifications'
import { CapabilityError, PermissionError } from '@/lib/services/errors'
import {
  makePushService,
  type PushService,
  type PushSubscriptionRecord,
} from '@/lib/services/push'
import { useCurrentAccount } from '@/lib/use-current-account'
import { trpc } from '@/trpc/client'

export const PUSH_SUBSCRIPTION_CHANGED_EVENT =
  'spliit:push-subscription-changed'

function broadcastPushSubscriptionChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PUSH_SUBSCRIPTION_CHANGED_EVENT))
  }
}

function toRecord(subscription: PushSubscription): PushSubscriptionRecord {
  const json = serializePushSubscription(subscription)
  return {
    endpoint: json.endpoint,
    keys: json.keys,
    unsubscribe: () => subscription.unsubscribe(),
  }
}

/**
 * Push presentation binding over the PushService (Task 8).
 *
 * Capability detection, permission, browser subscribe/unsubscribe, and server
 * registration/removal compose inside the service; this hook keeps presentation +
 * dispatch: the local subscription object mirror (for the server status read),
 * config/status queries, invalidations, and the subscription-changed event
 * fan-out. Effects run at the React boundary.
 *
 * No indefinite serviceWorker.ready wait anywhere on this path: the service
 * resolves getRegistration either way and the local mirror uses
 * getPushSubscription (getRegistration-based). Permission is requested inside
 * enable, which callers dispatch from a user gesture.
 */
export function usePushNotifications() {
  const supported = isPushSupported()
  // No unauthed consumer needs push state (onboarding + settings both require
  // an account). Gating here stops protected `status` from 401ing on public
  // pages like the signed-out landing, which previously fed the global
  // auth-error -> verifySession -> query clear -> refetch loop.
  const { data: account } = useCurrentAccount()
  const [subscription, setSubscription] = useState<PushSubscription | null>(
    null,
  )
  const [isLoadingSubscription, setIsLoadingSubscription] = useState(supported)
  const [error, setError] = useState<Error | null>(null)
  const subscriptionLoad = useRef(0)
  const config = trpc.notifications.push.getConfig.useQuery(undefined, {
    enabled: supported && !!account,
    staleTime: Infinity,
    retry: false,
  })
  const utils = trpc.useUtils()
  const register = trpc.notifications.push.register.useMutation()
  const remove = trpc.notifications.push.remove.useMutation()
  const status = trpc.notifications.push.status.useQuery(
    { endpoint: subscription?.endpoint ?? 'https://invalid.local/disabled' },
    {
      enabled: supported && !!subscription && !!account,
      staleTime: 30_000,
      retry: false,
    },
  )

  // tRPC bridges for the service (React-boundary adapters; signals are
  // accepted and ignored — the mutations are short and settled by TanStack).
  // A plain stable cell (not a React ref): the service outlives renders and
  // reads the latest mutations only from post-mount callbacks.
  const [mutationCell] = useState(() => ({
    current: { register, remove },
  }))
  useEffect(() => {
    // oxlint-disable-next-line react/immutability -- cell refreshes the service bridges post-mount; never read during render.
    mutationCell.current = { register, remove }
  }, [register, remove, mutationCell])
  const [service] = useState<PushService>(() =>
    makePushService({
      isSupported: () => isPushSupported(),
      getRegistration: () => getPushRegistration(),
      getSubscription: () =>
        getPushSubscription().then((current) =>
          current ? toRecord(current) : null,
        ),
      subscribe: (vapidPublicKey) =>
        subscribeToPush(vapidPublicKey).then(toRecord),
      registerOnServer: (input) =>
        mutationCell.current.register
          .mutateAsync({
            ...input,
            userAgent: navigator.userAgent,
          })
          .then(() => undefined),
      removeFromServer: (endpoint) =>
        mutationCell.current.remove
          .mutateAsync({ endpoint })
          .then(() => undefined),
    }),
  )

  const refreshSubscription = useCallback(async () => {
    if (!supported) return
    const load = ++subscriptionLoad.current
    setIsLoadingSubscription(true)
    try {
      const value = await getPushSubscription()
      if (load === subscriptionLoad.current) setSubscription(value)
    } catch (cause: unknown) {
      if (load === subscriptionLoad.current) {
        setError(cause instanceof Error ? cause : new Error())
      }
    } finally {
      if (load === subscriptionLoad.current) setIsLoadingSubscription(false)
    }
  }, [supported])

  useEffect(() => {
    if (!supported) return
    const handleSubscriptionChanged = () => void refreshSubscription()
    // oxlint-disable-next-line react/set-state-in-effect -- refresh state from the browser push subscription event.
    void refreshSubscription()
    window.addEventListener(
      PUSH_SUBSCRIPTION_CHANGED_EVENT,
      handleSubscriptionChanged,
    )
    return () => {
      subscriptionLoad.current += 1
      window.removeEventListener(
        PUSH_SUBSCRIPTION_CHANGED_EVENT,
        handleSubscriptionChanged,
      )
    }
  }, [refreshSubscription, supported])

  useEffect(() => {
    if (!subscription || status.data?.subscribed !== false || status.isFetching)
      return
    let active = true
    // The server dropped the row (e.g. sign-out on another device): settle
    // locally through the service and invalidate dependents.
    void Effect.runPromise(service.disable)
      .then(() => utils.notifications.preferences.get.invalidate())
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setSubscription(null)
          broadcastPushSubscriptionChanged()
        }
      })
    return () => {
      active = false
    }
  }, [status.data?.subscribed, status.isFetching, subscription, utils, service])

  // oxlint-disable react/preserve-manual-memoization -- this callback is intentionally stable for consumers.
  const enable = useCallback(async () => {
    setError(null)
    if (!config.data?.vapidPublicKey) throw new Error('Push is not configured')
    try {
      const outcome = await Effect.runPromise(
        service.enable(config.data.vapidPublicKey),
      )
      if (!outcome.enabled) {
        // Server registration failed while the browser holds a subscription:
        // explicit outcome for retry (the pre-service code surfaced the tRPC
        // error here; the row error is intentionally not retried blindly).
        throw new Error('Push registration failed')
      }
      await refreshSubscription()
      broadcastPushSubscriptionChanged()
      await Promise.all([
        utils.notifications.push.status.invalidate({
          endpoint:
            (await getPushSubscription())?.endpoint ??
            'https://invalid.local/disabled',
        }),
        utils.notifications.preferences.get.invalidate(),
      ])
    } catch (cause: unknown) {
      const nextError = toEnableError(cause)
      setError(nextError)
      throw nextError
    }
  }, [config.data?.vapidPublicKey, refreshSubscription, service, utils])
  // oxlint-enable react/preserve-manual-memoization

  const disable = useCallback(async () => {
    setError(null)
    try {
      await Effect.runPromise(service.disable)
      setSubscription(null)
      broadcastPushSubscriptionChanged()
      await utils.notifications.preferences.get.invalidate()
    } catch (cause: unknown) {
      const nextError = cause instanceof Error ? cause : new Error()
      setError(nextError)
      throw nextError
    }
  }, [service, utils])

  const disconnect = useCallback(async () => {
    // Sign-out cleanup through the service: best-effort everything, logout
    // always completes even when the browser discarded its endpoint.
    return Effect.runPromise(service.disconnectForSignOut).catch(() => false)
  }, [service])

  // A browser can keep a local subscription after its server row was removed
  // (for example after signing out on another device). Prefer the server's
  // answer when it is known, while retaining the local value while the status
  // request is in flight.
  const enabled = !!subscription && (status.data?.subscribed ?? true)

  return {
    supported,
    configured: config.data?.configured ?? false,
    iosHomeScreenRequired: isIosHomeScreenRequired(),
    permission: supported ? Notification.permission : 'unsupported',
    subscription,
    enabled,
    isLoading:
      isLoadingSubscription ||
      config.isPending ||
      (!!subscription && status.isPending),
    isUpdating: register.isPending || remove.isPending,
    error: error ?? config.error ?? status.error,
    enable,
    disable,
    disconnect,
  }
}

/**
 * Map the service's typed enable failure back to the hook's historical errors
 * (same copy the hook raised before): unsupported capability and denied
 * permission keep their messages; anything else surfaces as-is.
 */
function toEnableError(cause: unknown): Error {
  if (cause instanceof CapabilityError) {
    return new Error('Push notifications are unsupported')
  }
  if (cause instanceof PermissionError) {
    return new Error('Push permission was denied')
  }
  return cause instanceof Error ? cause : new Error()
}
