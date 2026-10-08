import { Effect, Layer, ManagedRuntime } from 'effect'

import {
  AppStatusService,
  makeAppStatus,
  type AppStatusSnapshot,
} from './app-status'
import { makeHealthProbe, type HealthProbeDeps } from './health'
import { HealthProbe } from './health'
import {
  makeFetchTransport,
  FetchTransport,
  PlatformClock,
  type FetchTransportDeps,
} from './platform'
import {
  ProbeOrchestratorLive,
  type ProbeOrchestrator,
} from './probe-orchestrator'
import type { SessionService } from './session'
import { SessionServiceLive } from './session-integration'

/**
 * Production layer graph (Task 1): platform primitives -> transport/auth
 * adapters -> orchestration. No circular dependencies: layers only point
 * downward (consumers provide providers via pipe).
 *
 * SessionService joins the default graph in Task 3 through the better-auth SDK
 * boundary (session-integration.ts). Services with requirements on siblings
 * (ProbeOrchestratorLive in Task 8; offline/PWA account scopes to follow) join
 * via provideMerge, never bare mergeAll — see AppServicesLive.
 */

export const PlatformClockLive = Layer.succeed(PlatformClock, {
  now: Effect.sync(() => Date.now()),
})

const FetchTransportDefaultLive = Layer.succeed(
  FetchTransport,
  makeFetchTransport(),
)

export function makeFetchTransportLive(
  deps?: FetchTransportDeps,
): Layer.Layer<FetchTransport> {
  if (!deps) {
    return FetchTransportDefaultLive
  }
  return Layer.succeed(FetchTransport, makeFetchTransport(deps))
}

export const FetchTransportLive = makeFetchTransportLive()

export function makeHealthProbeLive(
  deps: Omit<HealthProbeDeps, 'transport'> & {
    readonly transport?: HealthProbeDeps['transport']
  },
): Layer.Layer<HealthProbe, never, FetchTransport> {
  if (deps.transport) {
    return Layer.succeed(
      HealthProbe,
      makeHealthProbe({ ...deps, transport: deps.transport }),
    )
  }
  return Layer.effect(
    HealthProbe,
    Effect.gen(function* () {
      const transport = yield* FetchTransport
      return makeHealthProbe({ ...deps, transport })
    }),
  )
}

export function makeAppStatusLive(
  initial?: AppStatusSnapshot,
): Layer.Layer<AppStatusService> {
  return Layer.succeed(AppStatusService, makeAppStatus(initial))
}

export const AppStatusLive = makeAppStatusLive()

export const TransportAdapterLive = makeHealthProbeLive({}).pipe(
  Layer.provide(FetchTransportLive),
)

const AppCoreLive = Layer.mergeAll(
  PlatformClockLive,
  FetchTransportLive,
  TransportAdapterLive,
  AppStatusLive,
  SessionServiceLive,
)

/**
 * Effect v4 composition rule this graph depends on: Layer.mergeAll builds
 * siblings concurrently but NEVER wires one sibling's outputs into another's
 * requirements (a dependent merged in directly fails at build with "Service not
 * found"). Dependent services join through provideMerge, which feeds the core
 * outputs into the dependent and keeps every instance single.
 */
export const AppServicesLive = ProbeOrchestratorLive.pipe(
  Layer.provideMerge(AppCoreLive),
)

export type AppServices =
  | PlatformClock
  | FetchTransport
  | HealthProbe
  | AppStatusService
  | SessionService
  | ProbeOrchestrator

/**
 * Page runtime factory (shape preview for Task 2; Task 2 owns bootstrap before
 * React rendering, StrictMode/HMR disposal, and account scoping). Promise
 * conversion happens only through this runtime at integration boundaries —
 * never inside services.
 */
export function makeAppRuntime() {
  return ManagedRuntime.make(AppServicesLive)
}
