import { useMemo } from 'react'

import { makeAppRuntime } from './layers'

/**
 * Page lifetime ownership (Task 2).
 *
 * One page ManagedRuntime exists per document, created before React renders
 * (see main.tsx). The runtime builds the Task-1 service graph once and owns its
 * scope until document teardown; HMR disposal and tests release it through
 * disposePageRuntime.
 *
 * StrictMode safety: the singleton lives at module scope, never in render or in
 * an effect, so StrictMode double-mount subscribes but never rebuilds it. HMR
 * safety: bootstrap registers an import.meta.hot dispose hook that releases
 * starters and the runtime scope, so a replaced module never leaves
 * listeners/ports behind.
 *
 * The PWA bundle (Task 6 services: update state machine, notification
 * navigation, install capture) starts here and its stop joins page disposal, so
 * listeners and message ports are released on ordinary disposal.
 */

export type PageRuntime = ReturnType<typeof makeAppRuntime>

export interface PageStarters {
  /** Returns its stop function (removes listeners/mode flags). */
  readonly initAppMode: () => () => void
  /**
   * Starts the page-scoped PWA service bundle (Task 6: update state machine,
   * notification navigation, install capture) and returns one combined stop
   * releasing listeners/ports/timers/fibers.
   */
  readonly startPwaServices: () => () => void
}

let pageRuntime: PageRuntime | null = null
let startersStop: (() => void) | null = null

/**
 * Run the starters and return one combined stop. Each starter owns its
 * listeners/ports/timers, and the combined stop releases exactly what the
 * starters returned.
 */
export function wirePageStarters(starters: PageStarters): () => void {
  const stopAppMode = starters.initAppMode()
  const stopPwa = starters.startPwaServices()
  return () => {
    try {
      stopPwa()
    } finally {
      stopAppMode()
    }
  }
}

export function getPageRuntime(): PageRuntime {
  if (!pageRuntime) pageRuntime = makeAppRuntime()
  return pageRuntime
}

/** Release starter listeners/ports first, then the runtime scope. */
export async function disposePageRuntime(): Promise<void> {
  const runtime = pageRuntime
  const stop = startersStop
  pageRuntime = null
  startersStop = null
  try {
    stop?.()
  } finally {
    await runtime?.dispose()
  }
}

function registerHotDispose(): void {
  try {
    const hot = (
      import.meta as unknown as {
        hot?: { dispose: (callback: () => void) => void }
      }
    ).hot
    hot?.dispose(() => {
      void disposePageRuntime()
    })
  } catch {
    // No HMR (production/test): disposal happens on document teardown.
  }
}

/**
 * Bootstrap the page runtime before React rendering. Idempotent: repeated calls
 * reuse the runtime and never re-run starters, so HMR re-execution and
 * StrictMode remounts cannot duplicate execution.
 */
export function bootstrapPageRuntime(starters: PageStarters): PageRuntime {
  const runtime = getPageRuntime()
  if (!startersStop) startersStop = wirePageStarters(starters)
  registerHotDispose()
  return runtime
}

/** Stable singleton handle for components; subscribes only, never creates. */
export function usePageRuntime(): PageRuntime {
  return useMemo(() => getPageRuntime(), [])
}
