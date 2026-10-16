import type { TRPCClientErrorLike } from '@trpc/client'
import { useCallback, useState } from 'react'

import { trpc } from '@/trpc/client'
import type { AppRouter, AppRouterOutput } from '@spliit/api/router'

type PreviewFromUrlResult = AppRouterOutput['groups']['importPreview']

export type PreviewProviderId = 'spliit' | 'tricount'

export type ImportSourceState = {
  data: PreviewFromUrlResult | undefined
  isLoading: boolean
  isError: boolean
  error: TRPCClientErrorLike<AppRouter> | null
  /** Trigger a fetch for the given URL. Dedupes identical consecutive URLs. */
  submit: (url: string) => void
  reset: () => void
}

/**
 * Single preview hook for URL-based providers. `spliit` hits `importPreview`
 * (spliit.app JSON fetch); `tricount` hits `tricountPreview` (server-side fetch
 * against api.tricount.bunq.com, so the browser never contacts Tricount).
 *
 * Shared fetch hook for both the wizard (?source=<url> handoff) and SourceStep
 * (URL-paste). Wraps `useQuery` so Strict-Mode and deduping are free.
 */
export function usePreviewSource(
  provider: PreviewProviderId,
): ImportSourceState {
  const [submittedUrl, setSubmittedUrl] = useState<string | null>(null)

  const spliitQuery = trpc.groups.importPreview.useQuery(
    { sourceUrl: submittedUrl ?? '' },
    { enabled: provider === 'spliit' && !!submittedUrl, retry: false },
  )
  const tricountQuery = trpc.groups.tricountPreview.useQuery(
    { sourceUrl: submittedUrl ?? '' },
    { enabled: provider === 'tricount' && !!submittedUrl, retry: false },
  )
  const query = provider === 'spliit' ? spliitQuery : tricountQuery

  const submit = useCallback((url: string) => {
    setSubmittedUrl((prev) => (prev === url ? prev : url))
  }, [])

  const reset = useCallback(() => {
    setSubmittedUrl(null)
  }, [])

  return {
    data: query.data,
    isLoading: query.isFetching,
    isError: query.isError,
    error: query.error,
    submit,
    reset,
  }
}
