import { Effect } from 'effect'

import { hasPwaUpdateBlockers } from '@/lib/pwa-update-blockers'
import { getPageRuntime } from '@/lib/services/runtime'

import { makePwaInstallService, type PwaInstallService } from './pwa-install'
import {
  makePwaNotificationService,
  type PwaNotificationService,
} from './pwa-notifications'
import {
  makePwaPersistence,
  type PwaPersistenceService,
} from './pwa-persistence'
import { makePwaUpdateService, type PwaUpdateService } from './pwa-updates'

/**
 * Page-level PWA service bundle (Task 6 wiring, Task 8 unified).
 *
 * Constructs the page-scoped update/notification/install services with
 * production browser defaults and starts them through the page ManagedRuntime
 * (Promise conversion at the bootstrap boundary only). The returned stop
 * releases capture listeners, message ports, manager timers, and the hourly
 * check fiber — wired into page disposal in main.tsx alongside the runtime.
 *
 * Single ownership (no dual engines):
 *
 * - Install capture lives ONLY in PwaInstallService (started here, before React
 *   renders). The install hook (use-install-prompt.ts) is a thin presentation
 *   binding over this bundle's install service — it owns no listeners.
 * - Update checks flow ONLY through the update service's checkNow gate (hourly
 *   while visible, foreground, reconnect, manual). The manager runs with its
 *   internal check subscription disabled (enableUpdateChecks:false) and keeps
 *   updatefound observation + coordinated activation, which is its job.
 *   registration.update is byte-compared and cheap either way.
 *
 * Storage persistence stays on-demand (ensureOnce after verified use), not
 * started: post-auth flows call requestPwaPersistence() once the session
 * verifies.
 */

export interface PwaPageDeps {
  readonly navigate: (url: string) => void | Promise<unknown>
  readonly hasBlockers?: () => boolean
}

export interface PwaPageServices {
  readonly updates: PwaUpdateService
  readonly notifications: PwaNotificationService
  readonly install: PwaInstallService
  readonly persistence: PwaPersistenceService
  readonly start: () => void
  readonly stop: () => void
}

let pageServices: PwaPageServices | null = null

/**
 * The page bundle created by main.tsx before React renders. Thin presentation
 * bindings (install hook, update pill) resolve the live services through here
 * instead of owning listeners themselves. Null outside the page lifecycle (SSR,
 * unit tests without a bundle) — callers render a closed state and tests inject
 * fresh service instances directly.
 */
export function getPwaPageServices(): PwaPageServices | null {
  return pageServices
}

export function createPwaPageServices(deps: PwaPageDeps): PwaPageServices {
  const hasBlockers = deps.hasBlockers ?? hasPwaUpdateBlockers
  const updates = makePwaUpdateService()
  const notifications = makePwaNotificationService({
    serviceWorker:
      typeof navigator !== 'undefined' && 'serviceWorker' in navigator
        ? navigator.serviceWorker
        : undefined,
    navigate: deps.navigate,
    hasBlockers,
  })
  const install = makePwaInstallService()
  const persistence = makePwaPersistence()

  const runtime = getPageRuntime()
  const run = (effect: Effect.Effect<unknown>): void => {
    void runtime.runPromise(effect).catch(() => {
      // Service start/stop are infallible by contract; a rejection here is
      // a defect containment backstop, never user-visible state.
    })
  }

  const services: PwaPageServices = {
    updates,
    notifications,
    install,
    persistence,
    start: () => {
      run(updates.start)
      run(notifications.start)
      run(install.start)
      // An explicit foreground check on boot; the manager reconciles waiting
      // workers through its own subscription once created.
      run(updates.checkNow('foreground'))
    },
    stop: () => {
      run(install.stop)
      run(notifications.stop)
      run(updates.dispose)
    },
  }
  // Single registration: main.tsx creates the bundle once before rendering;
  // thin bindings resolve it through getPwaPageServices().
  pageServices = services
  return services
}

/**
 * One-shot persistent-storage request after verified use. Resolves the outcome
 * string; never throws, never re-prompts (marker-guarded inside).
 */
export function requestPwaPersistence(): Promise<string> {
  const service = makePwaPersistence()
  return Effect.runPromise(service.ensureOnce)
}
