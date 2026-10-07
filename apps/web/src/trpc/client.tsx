import type { QueryClient } from '@tanstack/react-query'
import { QueryClientProvider } from '@tanstack/react-query'
import { httpBatchLink } from '@trpc/client'
import { createTRPCReact } from '@trpc/react-query'
import { useState } from 'react'
import superjson from 'superjson'

import { getApiBaseUrl } from '@/lib/api-url'
import { createOfflineWriteGuardLink } from '@/lib/offline/write-guard'
import {
  createEffectFetch,
  reportFetchOutcomeToServices,
} from '@/lib/services/transport-integration'
import type { AppRouter } from '@spliit/api/router'

import { makeQueryClient } from './query-client'

// react-doctor-disable-next-line react-doctor/only-export-components -- tRPC client singleton co-exported with provider
export const trpc = createTRPCReact<AppRouter>()

let clientQueryClientSingleton: QueryClient
let trpcClientSingleton: ReturnType<typeof trpc.createClient> | undefined

export function getQueryClient() {
  if (typeof window === 'undefined') {
    // Server: always make a new query client
    return makeQueryClient()
  }
  // Browser: use singleton pattern to keep the same query client
  return (clientQueryClientSingleton ??= makeQueryClient())
}

function getUrl() {
  return `${getApiBaseUrl()}/trpc`
}

// Effect-backed transport for tRPC (Task 8): TanStack query signals reach
// the underlying fetch; each outcome is classified once and projected to both
// the legacy connectivity store (trackedFetch parity) and the AppStatus bridge
// through the canonical reporter in transport-integration. No inline fan-out
// here. The write-guard link still rejects known-offline mutations before any
// request; probes/verification bypass it by construction.
const effectFetch = createEffectFetch({
  report: reportFetchOutcomeToServices,
})

export function getTrpcClient() {
  return (trpcClientSingleton ??= trpc.createClient({
    links: [
      // Write guard: rechecks transport immediately before any
      // imperative tRPC mutation and throws OfflineWriteError without sending
      // a request. Queries pass through (offline adapters use disjoint keys).
      // Probes/session verification bypass by construction (plain fetch).
      createOfflineWriteGuardLink(),
      httpBatchLink({
        transformer: superjson,
        url: getUrl(),
        fetch(url, options) {
          return effectFetch(url, {
            ...options,
            credentials: 'include',
          })
        },
      }),
    ],
  }))
}

export function TRPCProvider(
  props: Readonly<{
    children: React.ReactNode
  }>,
) {
  // NOTE: Avoid useState when initializing the query client if you don't
  //       have a suspense boundary between this and the code that may
  //       suspend because React will throw away the client on the initial
  //       render if it suspends and there is no boundary
  const queryClient = getQueryClient()
  const [trpcClient] = useState(getTrpcClient)
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {props.children}
      </QueryClientProvider>
    </trpc.Provider>
  )
}
