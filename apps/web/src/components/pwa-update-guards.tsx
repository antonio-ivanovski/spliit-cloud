import { useIsMutating } from '@tanstack/react-query'
import { useRouterState } from '@tanstack/react-router'

import {
  usePwaUpdateBlocker,
  usePwaUpdateCompositionGuard,
} from '@/lib/pwa-update-blockers'

/** Backstop: wait for every in-flight mutation before automatically reloading. */
export function PwaUpdateMutationGuard() {
  const mutating = useIsMutating()
  usePwaUpdateBlocker(mutating > 0, 'mutation-in-flight')
  return null
}

/**
 * Holds a hard operation blocker while the user is composing text. A reload
 * would discard the uncommitted string.
 */
export function PwaUpdateCompositionGuard() {
  usePwaUpdateCompositionGuard()
  return null
}

/** Let the current route transition finish before automatically reloading. */
export function PwaUpdateNavigationGuard() {
  const navigating = useRouterState({ select: (state) => state.isLoading })
  usePwaUpdateBlocker(navigating, 'navigation-pending')
  return null
}
