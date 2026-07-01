import { useCurrentGroup } from '@/app/groups/[groupId]/current-group-context'
import { trpc } from '@/trpc/client'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    // Prevents SSR issues
    if (typeof window !== 'undefined') {
      return window.matchMedia(query).matches
    }
    return false
  })

  useEffect(() => {
    const matchMedia = window.matchMedia(query)

    const handleChange = () => {
      setMatches(matchMedia.matches)
    }

    matchMedia.addEventListener('change', handleChange)

    return () => {
      matchMedia.removeEventListener('change', handleChange)
    }
  }, [query])

  return matches
}

export function useBaseUrl() {
  const [baseUrl] = useState(() => window.location.origin)
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
function useCurrentGroupSafe(): ReturnType<typeof useCurrentGroup> | null {
  try {
    return useCurrentGroup()
  } catch {
    return null
  }
}

export function useActiveUser(groupId?: string) {
  const ctx = useCurrentGroupSafe()

  if (!ctx || ctx.groupId !== groupId) return null
  if (ctx.isLoading) return null
  return ctx.currentLedgerParticipantId
}

type UseCurrencyRateResult = {
  data: number | undefined
  error: Error | null
  isLoading: boolean
  refresh: () => Promise<unknown>
}

/**
 * Fetch the exchange rate for an expense-form conversion via the API
 * (which itself talks to the Frankfurter rate provider and caches the
 * result in-process). Going through the API sidesteps the CORS error the
 * browser raises when calling `api.frankfurter.app` directly: that
 * endpoint 301-redirects to `api.frankfurter.dev/v1/...` without
 * `Access-Control-Allow-Origin` headers, so the redirect itself is
 * blocked. The server-side fetch has no such restriction.
 *
 * Returns the rate as `data` and a `RangeError` in `error` when the
 * provider's as-of date doesn't match the requested date (e.g. the
 * user picked a future date or a weekend and the API fell back to the
 * latest available rate).
 */
export function useCurrencyRate(
  date: Date,
  baseCurrency: string,
  targetCurrency: string,
): UseCurrencyRateResult {
  const dateString = dayjs(date).format('YYYY-MM-DD')

  const enabled =
    !isNaN(date.getTime()) &&
    !!baseCurrency.length &&
    !!targetCurrency.length &&
    baseCurrency !== targetCurrency

  const { data, error, isLoading, refetch } = trpc.currency.getRate.useQuery(
    { date: dateString, base: baseCurrency, target: targetCurrency },
    { enabled, retry: false, refetchOnWindowFocus: false },
  )

  if (!data) {
    return {
      data: undefined,
      error: error ? new Error(error.message) : null,
      isLoading,
      refresh: () => refetch(),
    }
  }

  let sentError: Error | null = error ? new Error(error.message) : null
  if (!error && data.asOfDate !== dateString) {
    // this happens if for example, the requested date is in the future.
    sentError = new RangeError(data.asOfDate)
  }

  return {
    data: data.rate,
    error: sentError,
    isLoading,
    refresh: () => refetch(),
  }
}

export type CurrencyRatesItem = {
  date: string
  base: string
  target: string
}

/**
 * Bulk FX lookup response. Mirrors the previous tRPC `currency.getRates`
 * payload so callers can swap transports without changing reads.
 */
export type CurrencyRatesResponse = Array<
  | {
      ok: true
      rate: {
        rate: number
        requestedDate: string
        asOfDate: string
        base: string
        target: string
      }
    }
  | {
      ok: false
      error:
        | { code: 'UNSUPPORTED_CURRENCY'; currency: string }
        | { code: 'RATE_NOT_FOUND'; target: string }
        | { code: 'INVALID_DATE'; date: string }
        | { code: 'PROVIDER_ERROR'; message: string }
    }
>

/**
 * Bulk FX lookup routed over POST so a large batch doesn't blow the
 * URL length limit (HTTP 431). React Query gives us caching, refetch
 * control, and loading/error state without the tRPC GET URL envelope.
 */
export function useCurrencyRates(
  items: CurrencyRatesItem[],
  options?: { enabled?: boolean },
) {
  const apiBaseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'
  const itemsKey = useMemo(
    () => items.map((i) => `${i.date}|${i.base}|${i.target}`).join(','),
    [items],
  )
  return useQuery<CurrencyRatesResponse>({
    queryKey: ['currency-rates', itemsKey],
    enabled: (options?.enabled ?? true) && items.length > 0,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const res = await fetch(`${apiBaseUrl}/currency/rates`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
        signal,
      })
      if (!res.ok) {
        throw new Error(`Currency rates request failed (${res.status})`)
      }
      const json = (await res.json()) as { results: CurrencyRatesResponse }
      return json.results
    },
  })
}
