import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { AppStatusService } from './app-status'
import { HealthProbe } from './health'
import { AppServicesLive, makeAppRuntime } from './layers'
import { FetchTransport, PlatformClock } from './platform'
import { ProbeOrchestrator } from './probe-orchestrator'
import { SessionService } from './session'

// Authoring gate (test-audit): this file owns the production boot-graph
// contract — the default layer graph builds and every service in it resolves
// through the real page runtime. Observable behavior: construction of the
// graph browsers boot from, with no network, storage, timer, or DOM work
// (the resolving effect only requires the tags and reads one pure snapshot).
// Credible regression: a dependent service joined without its requirements
// wired (the Layer.provideMerge rule documented in layers.ts), or a factory
// that defects during layer construction, fails here instead of as
// "Service not found" on first real browser use. Existing coverage does not
// catch it: runtime.test.ts owns only the singleton bootstrap/disposal
// lifecycle with stub starters and never builds AppServicesLive, and every
// other services test builds its service through make* with stub deps — a
// grep for AppServicesLive in tests finds only this file. No production seam:
// construction uses makeAppRuntime and resolution uses the production tags.
// Sensitivity was demonstrated with a scratch (uncommitted, since deleted)
// broken-graph test joining the same siblings via bare mergeAll, which fails
// at build with a missing-service defect while this test passes.

describe('production service graph', () => {
  it('builds the default graph with every service resolvable', async () => {
    const runtime = makeAppRuntime()
    try {
      const snapshot = await runtime.runPromise(
        Effect.gen(function* () {
          yield* PlatformClock
          yield* FetchTransport
          yield* HealthProbe
          const status = yield* AppStatusService
          yield* SessionService
          const orchestrator = yield* ProbeOrchestrator
          // Read-only proof the resolved instances are live: the initial
          // snapshot is observable and the orchestrator exposes its entry
          // points (no probe, verification, timer, or fetch runs here).
          const appStatus = yield* status.snapshot
          return {
            transport: appStatus.transport,
            canProbe: typeof orchestrator.probeNow === 'function',
          }
        }),
      )
      expect(AppServicesLive).toBeDefined()
      expect(snapshot).toEqual({ transport: 'unknown', canProbe: true })
    } finally {
      // Ordinary disposal releases the runtime scope; a leaked scope would
      // fail subsequent tests sharing fake-indexeddb/Dexie handles.
      await runtime.dispose()
    }
  })
})
