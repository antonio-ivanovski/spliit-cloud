import { afterEach, describe, expect, it, vi } from 'vitest'

const recurrenceMocks = vi.hoisted(() => ({
  materialize: vi.fn(),
  reconcile: vi.fn(),
}))
const cleanupMocks = vi.hoisted(() => ({
  anonymousAccounts: vi.fn(),
}))

vi.mock('@spliit/api/lib/api/recurrence-series', () => ({
  materializeRecurringExpense: recurrenceMocks.materialize,
  reconcileDueRecurringExpenses: recurrenceMocks.reconcile,
}))

vi.mock('@spliit/api/lib/auth/anonymous-account-cleanup', () => ({
  runAnonymousAccountCleanup: cleanupMocks.anonymousAccounts,
}))

import { JOB_NAMES } from '@spliit/jobs'

import { handlers } from './handlers'

describe('recurring materialization worker handler', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('delegates to materializeRecurringExpense with the payload and boss', async () => {
    const boss = {} as never
    const payload = {
      seriesId: 'series-1',
      sequence: 2,
      occurrenceDate: '2026-07-22',
    }

    await handlers[JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE]!(payload, {
      boss,
      name: JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE,
      jobId: 'job-1',
      signal: new AbortController().signal,
      retryCount: 0,
      retryLimit: 5,
    })

    expect(recurrenceMocks.materialize).toHaveBeenCalledWith(payload, boss)
  })
})

describe('anonymous account cleanup worker handler', () => {
  it('delegates to the cleanup and reports the deleted count', async () => {
    cleanupMocks.anonymousAccounts.mockResolvedValueOnce({ deleted: 3 })
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await handlers[JOB_NAMES.ANONYMOUS_ACCOUNT_CLEANUP]!(
      {},
      {
        boss: {} as never,
        name: JOB_NAMES.ANONYMOUS_ACCOUNT_CLEANUP,
        jobId: 'job-cleanup',
        signal: new AbortController().signal,
        retryCount: 0,
        retryLimit: 0,
      },
    )

    expect(cleanupMocks.anonymousAccounts).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({
        component: 'anonymous-account-cleanup',
        deleted: 3,
      }),
    )
  })
})
