import { afterEach, describe, expect, it, vi } from 'vitest'

const recurrenceMocks = vi.hoisted(() => ({
  materialize: vi.fn(),
  reconcile: vi.fn(),
}))

vi.mock('@spliit/api/lib/api/recurrence-series', () => ({
  materializeRecurringExpense: recurrenceMocks.materialize,
  reconcileDueRecurringExpenses: recurrenceMocks.reconcile,
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
