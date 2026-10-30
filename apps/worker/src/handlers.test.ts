import { describe, expect, it, vi } from 'vitest'

import { assertHandlersRegistered, JOB_NAMES } from '@spliit/jobs'

const hoisted = vi.hoisted(() => ({
  materialize: vi.fn(async () => ({ created: true })),
  reconcile: vi.fn(async () => ({ scanned: 1, enqueued: 1, nextCursor: null })),
  reconcileAccounts: vi.fn(async () => ({
    scanned: 2,
    reconciled: 2,
    nextCursor: null,
  })),
}))

vi.mock('@spliit/api/lib/personal/recurring-materialize', () => ({
  materializePersonalRecurringSeries: hoisted.materialize,
  reconcileDuePersonalRecurringSeries: hoisted.reconcile,
}))

vi.mock('@spliit/api/lib/personal/reconcile-accounts', () => ({
  reconcilePersonalAccounts: hoisted.reconcileAccounts,
}))

import { handlers } from './handlers'

describe('worker handlers', () => {
  it('registers every job including personal recurring', () => {
    expect(() => assertHandlersRegistered(handlers)).not.toThrow()
    expect(handlers[JOB_NAMES.MATERIALIZE_PERSONAL_RECURRING]).toBeDefined()
    expect(handlers[JOB_NAMES.RECONCILE_PERSONAL_RECURRING]).toBeDefined()
    // Group recurring stays untouched.
    expect(handlers[JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE]).toBeDefined()
    expect(handlers[JOB_NAMES.RECONCILE_RECURRING_EXPENSES]).toBeDefined()
  })

  it('dispatches personal materialization without group sync', async () => {
    const handler = handlers[JOB_NAMES.MATERIALIZE_PERSONAL_RECURRING]!
    await handler(
      { seriesId: 's-1', sequence: 1, occurrenceDate: '2026-10-20' },
      {
        boss: {} as never,
        name: JOB_NAMES.MATERIALIZE_PERSONAL_RECURRING,
        jobId: 'j-1',
        signal: new AbortController().signal,
        retryCount: 0,
        retryLimit: 5,
      },
    )
    expect(hoisted.materialize).toHaveBeenCalledWith(
      { seriesId: 's-1', sequence: 1, occurrenceDate: '2026-10-20' },
      expect.anything(),
    )
  })

  it('dispatches personal reconciliation', async () => {
    const handler = handlers[JOB_NAMES.RECONCILE_PERSONAL_RECURRING]!
    await handler(
      {},
      {
        boss: {} as never,
        name: JOB_NAMES.RECONCILE_PERSONAL_RECURRING,
        jobId: 'j-2',
        signal: new AbortController().signal,
        retryCount: 0,
        retryLimit: 0,
      },
    )
    expect(hoisted.reconcile).toHaveBeenCalled()
  })

  it('registers and dispatches the daily personal reconcile', async () => {
    expect(handlers[JOB_NAMES.RECONCILE_PERSONAL]).toBeDefined()
    const handler = handlers[JOB_NAMES.RECONCILE_PERSONAL]!
    await handler(
      { cursor: 'a-1' },
      {
        boss: {} as never,
        name: JOB_NAMES.RECONCILE_PERSONAL,
        jobId: 'j-3',
        signal: new AbortController().signal,
        retryCount: 0,
        retryLimit: 3,
      },
    )
    expect(hoisted.reconcileAccounts).toHaveBeenCalledWith(expect.anything(), {
      cursor: 'a-1',
    })
  })
})
