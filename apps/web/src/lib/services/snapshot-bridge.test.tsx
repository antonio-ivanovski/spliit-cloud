import { renderHook } from '@testing-library/react'
import { Effect } from 'effect'
import { act } from 'react'
import { describe, expect, it } from 'vitest'

import { createSnapshotBridge, useServiceSnapshot } from './snapshot'

// Authoring gate (test-audit): this file owns the single-bridge React
// contract — stable snapshots, selector-only re-renders, no duplicate stores.
// Regression: a bridge that re-renders on unrelated slices would couple every
// status consumer to every publisher; a getSnapshot that returns fresh
// identities would loop. Hook-level proof is the production boundary (React
// reads the bridge here, nowhere else). No seams: a plain in-memory bridge.

type MiniSnapshot = {
  readonly transport: string
  readonly session: string
}

const selectTransport = (snapshot: MiniSnapshot) => snapshot.transport

function renderTransport(
  bridge: ReturnType<typeof createSnapshotBridge<MiniSnapshot>>,
) {
  let renders = 0
  const hook = renderHook(() => {
    renders += 1
    return useServiceSnapshot(bridge, selectTransport)
  })
  return {
    hook,
    renders: () => renders,
  }
}

describe('snapshot bridge', () => {
  it('publishes one stable snapshot until the next publish', () => {
    const bridge = createSnapshotBridge<MiniSnapshot>({
      transport: 'unknown',
      session: 'unknown',
    })
    expect(bridge.getSnapshot()).toBe(bridge.getSnapshot())

    let notifications = 0
    const unsubscribe = bridge.subscribe(() => {
      notifications += 1
    })
    const current = bridge.getSnapshot()
    bridge.publish(current)
    expect(notifications).toBe(0)
    bridge.publish({ transport: 'reachable', session: 'unknown' })
    expect(notifications).toBe(1)
    unsubscribe()
    bridge.publish({ transport: 'unreachable', session: 'unknown' })
    expect(notifications).toBe(1)
  })

  it('re-renders only when the selected slice changes', () => {
    const bridge = createSnapshotBridge<MiniSnapshot>({
      transport: 'unknown',
      session: 'unknown',
    })
    const { hook, renders } = renderTransport(bridge)
    expect(hook.result.current).toBe('unknown')
    const base = renders()

    act(() => {
      bridge.publish({ transport: 'unknown', session: 'active' })
    })
    expect(hook.result.current).toBe('unknown')
    expect(renders()).toBe(base)

    act(() => {
      bridge.publish({ transport: 'reachable', session: 'active' })
    })
    expect(hook.result.current).toBe('reachable')
    expect(renders()).toBeGreaterThan(base)
  })

  it('drives updates through Effect composition', async () => {
    const bridge = createSnapshotBridge<MiniSnapshot>({
      transport: 'unknown',
      session: 'unknown',
    })
    await Effect.runPromise(
      bridge.updateEffect((current) => ({ ...current, session: 'revoked' })),
    )
    expect(bridge.getSnapshot()).toEqual({
      transport: 'unknown',
      session: 'revoked',
    })
    await Effect.runPromise(bridge.readEffect).then((snapshot) => {
      expect(snapshot.session).toBe('revoked')
    })
  })
})
