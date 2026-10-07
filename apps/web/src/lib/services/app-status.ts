import { Context, SubscriptionRef } from 'effect'
import type { Effect } from 'effect'

import type { ServerFailure, TransportState } from '@/lib/offline/connectivity'

import type { ProbeOutcome } from './health'
import type { SessionVerification } from './session'
import { createSnapshotBridge, type SnapshotBridge } from './snapshot'

export type SessionScopeStatus = 'unknown' | 'active' | 'revoked' | 'preserved'

/**
 * The single observable service snapshot. React subscribes to this one bridge
 * (snapshot.ts); service internals never keep a second copy.
 *
 * Task 8 DECISION — PWA fields stay OUT (documented, implemented as-is):
 * transport/session are the only cross-cutting dimensions every consumer needs
 * (online gating, write guards, banners). PWA lifecycle state (update status,
 * install readiness, notification routing, persistence) is consumed by exactly
 * one surface each and stays on its dedicated service bridge (PwaUpdateService,
 * PwaInstallService, PwaNotificationService, PwaPersistenceService), selected
 * via useServiceSnapshot. Folding them in here would force every
 * transport/session subscriber to re-render on unrelated PWA transitions and
 * give AppStatus two writers for state it never owns. Revisit only if a second
 * consumer needs the same PWA dimension.
 */
export interface AppStatusSnapshot {
  readonly transport: TransportState
  readonly serverFailure: ServerFailure
  readonly session: SessionScopeStatus
  readonly updatedAt: number
}

export const INITIAL_APP_STATUS: AppStatusSnapshot = {
  transport: 'unknown',
  serverFailure: null,
  session: 'unknown',
  updatedAt: 0,
}

export interface AppStatusService {
  readonly bridge: SnapshotBridge<AppStatusSnapshot>
  readonly snapshot: Effect.Effect<AppStatusSnapshot>
  readonly reportProbe: (
    outcome: ProbeOutcome,
    now?: number,
  ) => Effect.Effect<void>
  readonly reportSession: (
    verification: SessionVerification,
  ) => Effect.Effect<void>
}

export const AppStatusService =
  Context.Service<AppStatusService>('AppStatusService')

function probeToSnapshot(
  current: AppStatusSnapshot,
  outcome: ProbeOutcome,
  now: number,
): AppStatusSnapshot {
  switch (outcome.outcome) {
    case 'unreachable':
      return { ...current, transport: 'unreachable', updatedAt: now }
    case 'reachable':
      return {
        ...current,
        transport: 'reachable',
        serverFailure: null,
        updatedAt: now,
      }
    case 'server-failure':
      return {
        ...current,
        transport: 'reachable',
        serverFailure: {
          kind: 'http-error',
          status: outcome.status,
          at: now,
        },
        updatedAt: now,
      }
    case 'portal':
      return {
        ...current,
        transport: 'reachable',
        serverFailure: { kind: 'portal', at: now },
        updatedAt: now,
      }
  }
}

function sessionToSnapshot(
  current: AppStatusSnapshot,
  verification: SessionVerification,
  now: number,
): AppStatusSnapshot {
  switch (verification.verdict) {
    case 'verified':
      return { ...current, session: 'active', updatedAt: now }
    case 'signed-out':
      return { ...current, session: 'revoked', updatedAt: now }
    case 'preserved-unavailable':
      return { ...current, session: 'preserved', updatedAt: now }
  }
}

export function makeAppStatus(
  initial: AppStatusSnapshot = INITIAL_APP_STATUS,
): AppStatusService {
  const bridge = createSnapshotBridge(initial)
  return {
    bridge,
    snapshot: SubscriptionRef.get(bridge.ref),
    reportProbe: (outcome, now) =>
      bridge.updateEffect((current) =>
        probeToSnapshot(current, outcome, now ?? Date.now()),
      ),
    reportSession: (verification) =>
      bridge.updateEffect((current) =>
        sessionToSnapshot(current, verification, Date.now()),
      ),
  }
}
