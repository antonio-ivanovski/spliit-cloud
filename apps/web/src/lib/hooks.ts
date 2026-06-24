import { useCurrentGroup } from '@/app/groups/[groupId]/current-group-context'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useEffect, useState } from 'react'

export function useMediaQuery(query: string): boolean {
  const getMatches = (query: string): boolean => {
    // Prevents SSR issues
    if (typeof window !== 'undefined') {
      return window.matchMedia(query).matches
    }
    return false
  }

  const [matches, setMatches] = useState<boolean>(getMatches(query))

  function handleChange() {
    setMatches(getMatches(query))
  }

  useEffect(() => {
    const matchMedia = window.matchMedia(query)

    // Triggered at the first client-side load and if query changes
    handleChange()

    // Listen matchMedia
    if (matchMedia.addListener) {
      matchMedia.addListener(handleChange)
    } else {
      matchMedia.addEventListener('change', handleChange)
    }

    return () => {
      if (matchMedia.removeListener) {
        matchMedia.removeListener(handleChange)
      } else {
        matchMedia.removeEventListener('change', handleChange)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  return matches
}

export function useBaseUrl() {
  const [baseUrl, setBaseUrl] = useState<string | null>(null)
  useEffect(() => {
    setBaseUrl(window.location.origin)
  }, [])
  return baseUrl
}

/**
 * Resolve the active ledger participant id for a group. With the
 * account-backed product, the active user is the signed-in account and the
 * matching `LedgerParticipant` id is resolved server-side via `groups.get`.
 *
 * This hook now reads from the `CurrentGroupContext` rather than
 * `localStorage`. Callers that are not inside a group layout will get
 * `null`. Returns `null` while the group is still loading.
 */
export function useActiveUser(groupId?: string) {
  let ctx: ReturnType<typeof useCurrentGroup> | null = null
  try {
    ctx = useCurrentGroup()
  } catch {
    ctx = null
  }
  const [activeUser, setActiveUser] = useState<string | null>(null)

  useEffect(() => {
    if (ctx && !ctx.isLoading && ctx.groupId === groupId) {
      setActiveUser(ctx.currentLedgerParticipantId)
    }
  }, [ctx, groupId])

  if (!ctx || ctx.groupId !== groupId) return null
  return activeUser
}

interface FrankfurterAPIResponse {
  base: string
  date: string
  rates: Record<string, number>
}

export function useCurrencyRate(
  date: Date,
  baseCurrency: string,
  targetCurrency: string,
) {
  const dateString = dayjs(date).format('YYYY-MM-DD')

  const enabled =
    !isNaN(date.getTime()) &&
    !!baseCurrency.length &&
    !!targetCurrency.length &&
    baseCurrency !== targetCurrency

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['currency-rate', dateString, baseCurrency, targetCurrency],
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const params = new URLSearchParams({ base: baseCurrency })
      const res = await fetch(
        `https://api.frankfurter.app/${dateString}?${params}`,
      )

      if (!res.ok) {
        throw new TypeError('Unsuccessful response from API', { cause: res })
      }

      return res.json() as Promise<FrankfurterAPIResponse>
    },
  })

  if (data) {
    let exchangeRate = undefined
    let sentError = error
    if (!error && data.date !== dateString) {
      // this happens if for example, the requested date is in the future.
      sentError = new RangeError(data.date)
    }
    if (data.rates[targetCurrency]) {
      exchangeRate = data.rates[targetCurrency]
    }
    return {
      data: exchangeRate,
      error: sentError,
      isLoading,
      refresh: refetch,
    }
  }

  return {
    data,
    error,
    isLoading,
    refresh: refetch,
  }
}
