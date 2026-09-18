import { defaultShouldDehydrateQuery, QueryClient } from '@tanstack/react-query'
import superjson from 'superjson'

import {
  createWriteGuardMutationCache,
  WRITE_GUARD_MUTATION_DEFAULTS,
} from '@/lib/offline/write-guard'

export function makeQueryClient() {
  return new QueryClient({
    // Write guard: known-offline mutations reject immediately via the
    // global MutationCache.onMutate (runs before per-mutation onMutate in the
    // installed query-core). networkMode:'always' keeps the guard reachable
    // while offline (never paused), retry:0 prevents queue/replay. No
    // resumePausedMutations, persister, or mutation restoration.
    mutationCache: createWriteGuardMutationCache(),
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
      },
      mutations: {
        networkMode: WRITE_GUARD_MUTATION_DEFAULTS.networkMode,
        retry: WRITE_GUARD_MUTATION_DEFAULTS.retry,
      },
      dehydrate: {
        serializeData: superjson.serialize,
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === 'pending',
      },
      hydrate: {
        deserializeData: superjson.deserialize,
      },
    },
  })
}
