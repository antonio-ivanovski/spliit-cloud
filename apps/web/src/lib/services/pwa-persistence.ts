import { Context, Effect, Layer } from 'effect'

import {
  clearPersistenceAttempt,
  ensurePersistentStorageOnce,
  isPersistenceWorthRequesting,
  PWA_PERSIST_ATTEMPT_KEY,
  type PersistenceEnvironment,
  type PersistenceRequestOutcome,
} from '@/lib/pwa-persistence'

import { createSnapshotBridge, type SnapshotBridge } from './snapshot'

/**
 * Storage-persistence service (Task 6).
 *
 * One-shot persistent-storage request after verified use, wrapped as an
 * infallible Effect: every outcome (persisted/declined/unsupported/skipped/
 * already) resolves as data, never as failure — denied/unsupported engines are
 * nonblocking by design. The attempt marker keeps its once-per-device semantics
 * (written before resolving, never retried or re-prompted); Firefox and unknown
 * engines are skipped rather than probed.
 *
 * Engine policy (isPersistenceWorthRequesting) and the marker protocol stay in
 * pwa-persistence.ts untouched; this service owns Effect composition and the
 * observable snapshot for diagnostics.
 */

export interface PwaPersistenceSnapshot {
  readonly attempted: boolean
  readonly outcome: PersistenceRequestOutcome | null
}

export const INITIAL_PERSISTENCE: PwaPersistenceSnapshot = {
  attempted: false,
  outcome: null,
}

export interface PwaPersistenceDeps {
  readonly environment?: PersistenceEnvironment
  readonly storage?:
    | (Pick<Storage, 'getItem' | 'setItem'> &
        Partial<Pick<Storage, 'removeItem'>>)
    | undefined
  readonly navigatorRef?:
    | { storage?: { persist?: () => Promise<boolean> } | undefined }
    | undefined
}

export interface PwaPersistenceService {
  readonly bridge: SnapshotBridge<PwaPersistenceSnapshot>
  readonly snapshot: Effect.Effect<PwaPersistenceSnapshot>
  /** Request persistence at most once. Never fails. */
  readonly ensureOnce: Effect.Effect<PersistenceRequestOutcome>
  /**
   * Post-install retry: clears the once-marker and requests again. Call on
   * `appinstalled`, when Chrome is most likely to grant persistence. Never
   * fails.
   */
  readonly retryAfterInstall: Effect.Effect<PersistenceRequestOutcome>
  /** Pure engine pre-check (no marker written). */
  readonly isWorthRequesting: Effect.Effect<boolean>
}

export const PwaPersistenceService = Context.Service<PwaPersistenceService>(
  'PwaPersistenceService',
)

export { PWA_PERSIST_ATTEMPT_KEY }

export function makePwaPersistence(
  deps?: PwaPersistenceDeps,
): PwaPersistenceService {
  const bridge = createSnapshotBridge(INITIAL_PERSISTENCE)

  // tryPromise (not promise): a helper/host rejection is an expected
  // outcome, never a defect. matchEffect recovers it to declined as DATA —
  // persistence is nonblocking by design, never a failure surfacing into
  // the caller.
  const ensureOnce = Effect.matchEffect(
    Effect.tryPromise({
      try: () =>
        ensurePersistentStorageOnce({
          environment: deps?.environment,
          storage: deps?.storage,
          navigatorRef: deps?.navigatorRef,
        }),
      catch: (error: unknown) => error,
    }),
    {
      onFailure: () => Effect.succeed('declined' as PersistenceRequestOutcome),
      onSuccess: (outcome) => Effect.succeed(outcome),
    },
  ).pipe(
    Effect.tap((outcome) => bridge.writeEffect({ attempted: true, outcome })),
  )

  return {
    bridge,
    snapshot: bridge.readEffect,
    ensureOnce,
    retryAfterInstall: Effect.matchEffect(
      Effect.tryPromise({
        try: () => {
          clearPersistenceAttempt(deps?.storage)
          return ensurePersistentStorageOnce({
            environment: deps?.environment,
            storage: deps?.storage,
            navigatorRef: deps?.navigatorRef,
          })
        },
        catch: (error: unknown) => error,
      }),
      {
        onFailure: () =>
          Effect.succeed('declined' as PersistenceRequestOutcome),
        onSuccess: (outcome) => Effect.succeed(outcome),
      },
    ).pipe(
      Effect.tap((outcome) => bridge.writeEffect({ attempted: true, outcome })),
    ),
    isWorthRequesting: Effect.sync(() =>
      isPersistenceWorthRequesting(deps?.environment ?? {}),
    ),
  }
}

/**
 * Page-scoped persistence layer. No teardown work: the marker write is
 * synchronous-before-resolve inside the helper.
 */
export function makePwaPersistenceLive(
  deps?: PwaPersistenceDeps,
): Layer.Layer<PwaPersistenceService> {
  return Layer.succeed(PwaPersistenceService, makePwaPersistence(deps))
}
