import { useCurrentAccount } from '@/lib/use-current-account'
import type { AppRouter } from '@spliit/api/router'
import {
  QueryClientProvider,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { httpBatchLink } from '@trpc/client'
import { createTRPCReact } from '@trpc/react-query'
import { useEffect, useState } from 'react'
import superjson from 'superjson'
import { makeQueryClient } from './query-client'
import {
  clearPersistedQueryCache,
  getStoredAccountId,
  QUERY_CACHE_BUSTER,
  QUERY_CACHE_MAX_AGE,
  queryCachePersister,
  setStoredAccountId,
  shouldDehydrateReadQuery,
} from './query-persistence'

export const trpc = createTRPCReact<AppRouter>()

let clientQueryClientSingleton: QueryClient

function getQueryClient() {
  if (typeof window === 'undefined') {
    // Server: always make a new query client
    return makeQueryClient()
  }
  // Browser: use singleton pattern to keep the same query client
  return (clientQueryClientSingleton ??= makeQueryClient())
}

function getUrl() {
  return `${import.meta.env.VITE_API_URL ?? 'http://localhost:3001'}/trpc`
}

/** Remove restored data when a session changes to a different account. */
function AccountCacheBoundary() {
  const queryClient = useQueryClient()
  const { data: account, isPending } = useCurrentAccount()
  const accountId = account?.id ?? null

  useEffect(() => {
    if (isPending) return

    const previousAccountId = getStoredAccountId()
    if (previousAccountId && previousAccountId !== accountId) {
      queryClient.clear()
      void clearPersistedQueryCache()
    }

    setStoredAccountId(accountId)
  }, [accountId, isPending, queryClient])

  return null
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
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          transformer: superjson,
          url: getUrl(),
          fetch(url, options) {
            return fetch(url, {
              ...options,
              credentials: 'include',
            })
          },
        }),
      ],
    }),
  )
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryCachePersister,
        maxAge: QUERY_CACHE_MAX_AGE,
        buster: QUERY_CACHE_BUSTER,
        dehydrateOptions: {
          serializeData: superjson.serialize,
          shouldDehydrateMutation: () => false,
          shouldDehydrateQuery: shouldDehydrateReadQuery,
        },
        hydrateOptions: {
          defaultOptions: {
            deserializeData: superjson.deserialize,
          },
        },
      }}
    >
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <AccountCacheBoundary />
          {props.children}
        </QueryClientProvider>
      </trpc.Provider>
    </PersistQueryClientProvider>
  )
}
