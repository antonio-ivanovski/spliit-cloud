import { trpc } from '@/trpc/client'
import type { AppRouter, AppRouterOutput } from '@spliit/api/router'
import { TRPCClientErrorLike } from '@trpc/client'
import { useCallback, useState } from 'react'

type PreviewFromUrlResult = AppRouterOutput['groups']['importPreview']

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
 * Shared fetch hook for both the wizard (?source=<url> handoff) and
 * SourceStep (URL-paste). Wraps `useQuery` so Strict-Mode and deduping
 * are free.
 */
export function useImportSource(): ImportSourceState {
  const [submittedUrl, setSubmittedUrl] = useState<string | null>(null)

  const query = trpc.groups.importPreview.useQuery(
    { sourceUrl: submittedUrl ?? '' },
    { enabled: !!submittedUrl, retry: false },
  )

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
