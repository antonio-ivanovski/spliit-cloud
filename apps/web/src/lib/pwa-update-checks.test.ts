import { describe, expect, it, vi } from 'vitest'

import { subscribeServiceWorkerUpdateChecks } from '@/lib/pwa-update-checks'

function createHarness() {
  const listeners = new Map<string, Set<EventListener>>()
  const addEventListener = (type: string, listener: EventListener) => {
    const set = listeners.get(type) ?? new Set()
    set.add(listener)
    listeners.set(type, set)
  }
  const removeEventListener = (type: string, listener: EventListener) => {
    listeners.get(type)?.delete(listener)
  }
  const dispatch = (type: string) => {
    for (const listener of listeners.get(type) ?? []) listener(new Event(type))
  }
  return { addEventListener, removeEventListener, dispatch, listeners }
}

describe('subscribeServiceWorkerUpdateChecks', () => {
  it('checks on focus, reconnect, and the interval', () => {
    const update = vi.fn().mockResolvedValue(undefined)
    const documentHarness = createHarness()
    const windowHarness = createHarness()
    const intervals: Array<() => void> = []
    let visibilityState: DocumentVisibilityState = 'hidden'

    const unsubscribe = subscribeServiceWorkerUpdateChecks(
      { update },
      {
        intervalMs: 1000,
        document: {
          addEventListener: documentHarness.addEventListener,
          removeEventListener: documentHarness.removeEventListener,
          get visibilityState() {
            return visibilityState
          },
        },
        window: {
          addEventListener: windowHarness.addEventListener,
          removeEventListener: windowHarness.removeEventListener,
          setInterval: (handler: TimerHandler) => {
            intervals.push(handler as () => void)
            return 1
          },
          clearInterval: vi.fn(),
        },
      },
    )

    visibilityState = 'visible'
    documentHarness.dispatch('visibilitychange')
    windowHarness.dispatch('online')
    intervals[0]?.()

    expect(update).toHaveBeenCalledTimes(3)

    unsubscribe()
    expect(documentHarness.listeners.get('visibilitychange')?.size ?? 0).toBe(0)
    expect(windowHarness.listeners.get('online')?.size ?? 0).toBe(0)
  })

  it('does not check while the document stays hidden', () => {
    const update = vi.fn().mockResolvedValue(undefined)
    const documentHarness = createHarness()

    subscribeServiceWorkerUpdateChecks(
      { update },
      {
        document: {
          addEventListener: documentHarness.addEventListener,
          removeEventListener: documentHarness.removeEventListener,
          visibilityState: 'hidden',
        },
        window: {
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          setInterval: vi.fn(() => 1),
          clearInterval: vi.fn(),
        },
      },
    )

    documentHarness.dispatch('visibilitychange')
    expect(update).not.toHaveBeenCalled()
  })
})
