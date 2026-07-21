import {
  disconnectPushSubscription,
  getPushSubscription,
  isIosHomeScreenRequired,
  isPushSupported,
  serializePushSubscription,
  subscribeToPush,
} from '@/lib/push-notifications'
import { trpc } from '@/trpc/client'
import { useCallback, useEffect, useState } from 'react'

export function usePushNotifications() {
  const supported = isPushSupported()
  const [subscription, setSubscription] = useState<PushSubscription | null>(
    null,
  )
  const [isLoadingSubscription, setIsLoadingSubscription] = useState(supported)
  const [error, setError] = useState<Error | null>(null)
  const config = trpc.notifications.push.getConfig.useQuery(undefined, {
    enabled: supported,
    staleTime: Infinity,
  })
  const register = trpc.notifications.push.register.useMutation()
  const remove = trpc.notifications.push.remove.useMutation()

  useEffect(() => {
    if (!supported) return
    let active = true
    void getPushSubscription()
      .then((value) => {
        if (active) setSubscription(value)
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause : new Error())
      })
      .finally(() => {
        if (active) setIsLoadingSubscription(false)
      })
    return () => {
      active = false
    }
  }, [supported])

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
    } catch (cause: unknown) {
      const nextError = cause instanceof Error ? cause : new Error()
      setError(nextError)
      throw nextError
    }
  }, [config.data?.vapidPublicKey, register, subscription])

  const disable = useCallback(async () => {
    setError(null)
    const current = subscription ?? (await getPushSubscription())
    try {
      if (current) await remove.mutateAsync({ endpoint: current.endpoint })
      await current?.unsubscribe()
      setSubscription(null)
    } catch (cause: unknown) {
      const nextError = cause instanceof Error ? cause : new Error()
      setError(nextError)
      throw nextError
    }
  }, [remove, subscription])

  return {
    supported,
    configured: config.data?.configured ?? false,
    iosHomeScreenRequired: isIosHomeScreenRequired(),
    permission: supported ? Notification.permission : 'unsupported',
    subscription,
    enabled: !!subscription,
    isLoading: isLoadingSubscription || config.isPending,
    isUpdating: register.isPending || remove.isPending,
    error: error ?? config.error,
    enable,
    disable,
    disconnect: disconnectPushSubscription,
  }
}
