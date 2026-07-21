import {
  disconnectPushSubscription,
  getPushSubscription,
  isIosHomeScreenRequired,
  isPushSupported,
  serializePushSubscription,
  subscribeToPush,
} from '@/lib/push-notifications'
import { trpc } from '@/trpc/client'
import { useCallback, useEffect, useRef, useState } from 'react'

export const PUSH_SUBSCRIPTION_CHANGED_EVENT =
  'spliit:push-subscription-changed'

function broadcastPushSubscriptionChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PUSH_SUBSCRIPTION_CHANGED_EVENT))
  }
}

export function usePushNotifications() {
  const supported = isPushSupported()
  const [subscription, setSubscription] = useState<PushSubscription | null>(
    null,
  )
  const [isLoadingSubscription, setIsLoadingSubscription] = useState(supported)
  const [error, setError] = useState<Error | null>(null)
  const subscriptionLoad = useRef(0)
  const config = trpc.notifications.push.getConfig.useQuery(undefined, {
    enabled: supported,
    staleTime: Infinity,
  })
  const utils = trpc.useUtils()
  const register = trpc.notifications.push.register.useMutation()
  const remove = trpc.notifications.push.remove.useMutation()
  const status = trpc.notifications.push.status.useQuery(
    { endpoint: subscription?.endpoint ?? 'https://invalid.local/disabled' },
    {
      enabled: supported && !!subscription,
      staleTime: 30_000,
      retry: false,
    },
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
    void Promise.all([
      subscription.unsubscribe().catch(() => undefined),
      utils.notifications.preferences.get.invalidate(),
    ]).finally(() => {
      if (active) {
        setSubscription(null)
        broadcastPushSubscriptionChanged()
      }
    })
    return () => {
      active = false
    }
  }, [status.data?.subscribed, status.isFetching, subscription, utils])

  const enable = useCallback(async () => {
    setError(null)
    if (!config.data?.vapidPublicKey) throw new Error('Push is not configured')
    try {
      const current =
        subscription ?? (await subscribeToPush(config.data.vapidPublicKey))
      await register.mutateAsync({
        ...serializePushSubscription(current),
        userAgent: navigator.userAgent,
      })
      setSubscription(current)
      broadcastPushSubscriptionChanged()
      await Promise.all([
        utils.notifications.push.status.invalidate({
          endpoint: current.endpoint,
        }),
        utils.notifications.preferences.get.invalidate(),
      ])
    } catch (cause: unknown) {
      const nextError = cause instanceof Error ? cause : new Error()
      setError(nextError)
      throw nextError
    }
  }, [config.data?.vapidPublicKey, register, subscription, utils])

  const disable = useCallback(async () => {
    setError(null)
    const current = subscription ?? (await getPushSubscription())
    try {
      if (current) await remove.mutateAsync({ endpoint: current.endpoint })
      await current?.unsubscribe()
      setSubscription(null)
      broadcastPushSubscriptionChanged()
      await utils.notifications.preferences.get.invalidate()
    } catch (cause: unknown) {
      const nextError = cause instanceof Error ? cause : new Error()
      setError(nextError)
      throw nextError
    }
  }, [remove, subscription, utils])

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
    disconnect: disconnectPushSubscription,
  }
}
