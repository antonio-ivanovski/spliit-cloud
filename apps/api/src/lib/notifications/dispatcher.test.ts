import type { ActivityData } from '@spliit/domain/activities'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CompositeActivityNotificationDispatcher,
  getDefaultActivityNotificationDispatcher,
  scheduleDefaultNotificationDispatch,
  scheduleNotificationDispatch,
  setDefaultActivityNotificationDispatchers,
  waitForScheduledNotificationDispatchesForTest,
} from './dispatcher'
import type {
  ActivityNotificationDispatcher,
  ActivityNotificationEvent,
} from './types'

function buildEvent(
  overrides: Partial<ActivityNotificationEvent> = {},
): ActivityNotificationEvent {
  const data: ActivityData = { kind: 'expense', summary: 'Dinner' }
  return {
    activityId: 'act-1',
    type: 'EXPENSE_CREATED',
    groupId: 'grp-1',
    actor: { type: 'ACCOUNT', id: 'acct-alice' },
    subject: { type: 'EXPENSE', id: 'exp-1' },
    data,
    occurredAt: new Date('2026-07-02T12:00:00Z'),
    ...overrides,
  }
}

class CapturingDispatcher implements ActivityNotificationDispatcher {
  events: ActivityNotificationEvent[] = []
  async dispatch(event: ActivityNotificationEvent): Promise<void> {
    this.events.push(event)
  }
}

class ThrowingDispatcher implements ActivityNotificationDispatcher {
  async dispatch(): Promise<void> {
    throw new Error('boom')
  }
}

afterEach(async () => {
  try {
    await waitForScheduledNotificationDispatchesForTest()
  } finally {
    setDefaultActivityNotificationDispatchers([])
    vi.restoreAllMocks()
  }
})

describe('CompositeActivityNotificationDispatcher', () => {
  it('forwards the event to every registered dispatcher in parallel', async () => {
    const a = new CapturingDispatcher()
    const b = new CapturingDispatcher()
    const composite = new CompositeActivityNotificationDispatcher([a, b])
    const event = buildEvent()
    await composite.dispatch(event)
    expect(a.events).toEqual([event])
    expect(b.events).toEqual([event])
  })

  it('continues dispatching when one implementation throws', async () => {
    const ok = new CapturingDispatcher()
    const broken = new ThrowingDispatcher()
    const composite = new CompositeActivityNotificationDispatcher([broken, ok])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await composite.dispatch(buildEvent())
    expect(ok.events).toHaveLength(1)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('handles an empty dispatcher list as a no-op', async () => {
    const composite = new CompositeActivityNotificationDispatcher([])
    await expect(composite.dispatch(buildEvent())).resolves.toBeUndefined()
  })
})

describe('scheduleNotificationDispatch', () => {
  it('returns immediately and dispatches on a later loop turn', async () => {
    const capture = new CapturingDispatcher()
    const start = Date.now()
    scheduleNotificationDispatch(capture, buildEvent())
    expect(capture.events).toHaveLength(0)
    // Wait long enough for the microtask to fire (queueMicrotask + a
    // single .then chain is on the order of microseconds, but a real
    // timer avoids flakiness on slow CI).
    await waitForScheduledNotificationDispatchesForTest()
    expect(capture.events).toHaveLength(1)
    expect(Date.now() - start).toBeLessThan(200)
  })

  it('catches dispatcher errors and logs them with console.warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    scheduleNotificationDispatch(new ThrowingDispatcher(), buildEvent())
    await waitForScheduledNotificationDispatchesForTest()
    expect(warn).toHaveBeenCalled()
    const message = warn.mock.calls[0].join(' ')
    expect(message).toContain('act-1')
    expect(message).toContain('boom')
    warn.mockRestore()
  })

  it('does not throw when the dispatcher rejects asynchronously', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = new ThrowingDispatcher()
    expect(() =>
      scheduleNotificationDispatch(broken, buildEvent()),
    ).not.toThrow()
    await waitForScheduledNotificationDispatchesForTest()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('drains dispatches scheduled by an in-flight dispatcher', async () => {
    const capture = new CapturingDispatcher()
    const schedulingDispatcher: ActivityNotificationDispatcher = {
      async dispatch() {
        await Promise.resolve()
        scheduleNotificationDispatch(
          capture,
          buildEvent({ activityId: 'nested' }),
        )
      },
    }

    scheduleNotificationDispatch(schedulingDispatcher, buildEvent())
    await waitForScheduledNotificationDispatchesForTest()

    expect(capture.events.map((event) => event.activityId)).toEqual(['nested'])
  })
})

describe('default singleton dispatcher', () => {
  it('returns the same composite instance until reset', () => {
    const before = getDefaultActivityNotificationDispatcher()
    const after = getDefaultActivityNotificationDispatcher()
    expect(before).toBe(after)
  })

  it('routes events through every registered dispatcher', async () => {
    const a = new CapturingDispatcher()
    const b = new CapturingDispatcher()
    setDefaultActivityNotificationDispatchers([a, b])
    try {
      const capture = getDefaultActivityNotificationDispatcher()
      const event = buildEvent({ activityId: 'singleton-1' })
      await capture.dispatch(event)
      expect(a.events.map((e) => e.activityId)).toEqual(['singleton-1'])
      expect(b.events.map((e) => e.activityId)).toEqual(['singleton-1'])
    } finally {
      setDefaultActivityNotificationDispatchers([])
    }
  })

  it('scheduleDefaultNotificationDispatch forwards to the singleton', async () => {
    const capture = new CapturingDispatcher()
    setDefaultActivityNotificationDispatchers([capture])
    try {
      scheduleDefaultNotificationDispatch(buildEvent({ activityId: 'sd-1' }))
      await waitForScheduledNotificationDispatchesForTest()
      expect(capture.events.map((e) => e.activityId)).toEqual(['sd-1'])
    } finally {
      setDefaultActivityNotificationDispatchers([])
    }
  })

  it('starts empty so the singleton is a safe no-op', async () => {
    setDefaultActivityNotificationDispatchers([])
    const dispatch = vi.spyOn(
      CompositeActivityNotificationDispatcher.prototype,
      'dispatch',
    )
    scheduleDefaultNotificationDispatch(buildEvent())
    await waitForScheduledNotificationDispatchesForTest()
    expect(dispatch).toHaveBeenCalled()
    // No events landed anywhere because the registry is empty.
    dispatch.mockRestore()
  })
})
