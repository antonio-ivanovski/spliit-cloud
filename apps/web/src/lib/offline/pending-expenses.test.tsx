import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'

import { renderHook } from '@/test/test-utils'

import { buildNamespace } from './contract'
import { deleteOfflineDatabaseForTests } from './database'
import {
  applyPendingExpenseResolution,
  clearPendingExpensesForTests,
  enqueuePendingExpense,
  enqueuePendingExpenseForTests,
  resetPendingExpensesCacheForTests,
  usePendingExpenses,
} from './pending-expenses'
import { OfflineWriteError } from './write-guard'

const NAMESPACE = buildNamespace('http://localhost:3001', 'overlay-test')
const REQUEST_ID = '00000000-0000-4000-8000-000000000001'

function makeExpense(overrides?: Record<string, unknown>) {
  return {
    title: 'Dinner',
    amount: 3000,
    paidByList: [{ participant: 'payer-1', shares: 3000 }],
    paidBySplitMode: 'BY_AMOUNT',
    isMultiPayer: false,
    paidFor: [{ participant: 'payer-1', shares: 1 }],
    category: 'general',
    splitMode: 'EVENLY',
    expenseDate: new Date('2026-03-02T12:00:00.000Z'),
    expenseTimeZone: 'UTC',
    documents: [],
    recurrenceRule: 'NONE',
    ...overrides,
  }
}

describe('usePendingExpenses offline-write seam', () => {
  beforeEach(async () => {
    clearPendingExpensesForTests()
    await deleteOfflineDatabaseForTests()
  })

  it('returns an empty overlay by default (writes still blocked offline)', () => {
    const { result } = renderHook(() => usePendingExpenses('g1'))

    expect(result.current).toEqual([])
  })

  it('overlays enqueued rows per group without leaking across groups', () => {
    enqueuePendingExpenseForTests('g1', {
      id: 'pending-1',
      clientId: 'pending-1',
      requestId: 'req-1',
      status: 'pending',
      expenseDate: new Date('2026-03-02T12:00:00Z'),
      createdAt: new Date('2026-03-02T13:00:00Z'),
      amount: 500,
    })

    const { result: g1 } = renderHook(() => usePendingExpenses('g1'))
    const { result: g2 } = renderHook(() => usePendingExpenses('g2'))

    expect(g1.current.map((row) => row.id)).toEqual(['pending-1'])
    expect(g2.current).toEqual([])
  })

  it('drops corrupt localStorage rows on load instead of merging them', () => {
    window.localStorage.setItem(
      'spliit-pending-expenses-v1',
      JSON.stringify({
        g1: [
          {
            id: 'pending-1',
            clientId: 'pending-1',
            requestId: 'req-1',
            status: 'pending',
            expenseDate: '2026-03-02T12:00:00.000Z',
            createdAt: '2026-03-02T13:00:00.000Z',
            amount: 500,
          },
          // Missing clientId/requestId/status: corrupt, must drop.
          { id: 'pending-bad', amount: 10 },
          'not-a-row',
        ],
        // Not an array: the whole group entry drops.
        g2: 'junk',
      }),
    )
    resetPendingExpensesCacheForTests()

    const { result: g1 } = renderHook(() => usePendingExpenses('g1'))
    const { result: g2 } = renderHook(() => usePendingExpenses('g2'))

    expect(g1.current.map((row) => row.id)).toEqual(['pending-1'])
    expect(g2.current).toEqual([])
  })

  it('ignores unparseable localStorage instead of crashing the overlay', () => {
    window.localStorage.setItem('spliit-pending-expenses-v1', '{oops')
    resetPendingExpensesCacheForTests()

    const { result } = renderHook(() => usePendingExpenses('g1'))

    expect(result.current).toEqual([])
  })
})

describe('enqueuePendingExpense overlay + outbox', () => {
  beforeEach(async () => {
    clearPendingExpensesForTests()
    await deleteOfflineDatabaseForTests()
  })

  it('persists the outbox row and mirrors the overlay immediately', async () => {
    const { record, queued } = await enqueuePendingExpense({
      namespace: NAMESPACE,
      groupId: 'g1',
      requestId: REQUEST_ID,
      expense: makeExpense(),
    })

    expect(record.clientId).toBe(`pending-${REQUEST_ID}`)
    expect(queued).toEqual({
      expenseId: `pending-${REQUEST_ID}`,
      recurringSeriesId: null,
    })

    const { result } = renderHook(() => usePendingExpenses('g1'))
    expect(result.current.map((row) => row.id)).toEqual([
      `pending-${REQUEST_ID}`,
    ])
    expect(result.current[0]).toMatchObject({
      amount: 3000,
      title: 'Dinner',
      status: 'pending',
    })
    // Re-enqueueing the same request id replaces instead of duplicating.
    await enqueuePendingExpense({
      namespace: NAMESPACE,
      groupId: 'g1',
      requestId: REQUEST_ID,
      expense: makeExpense(),
    })
    const { result: after } = renderHook(() => usePendingExpenses('g1'))
    expect(after.current).toHaveLength(1)
  })

  it('fails closed with OfflineWriteError for invalid input', async () => {
    await expect(
      enqueuePendingExpense({
        namespace: NAMESPACE,
        groupId: 'g1',
        requestId: REQUEST_ID,
        expense: makeExpense({ amount: 0 }),
      }),
    ).rejects.toBeInstanceOf(OfflineWriteError)

    const { result } = renderHook(() => usePendingExpenses('g1'))
    expect(result.current).toEqual([])
  })

  it('removes temp rows on sent and pins failed rows', async () => {
    const { record } = await enqueuePendingExpense({
      namespace: NAMESPACE,
      groupId: 'g1',
      requestId: REQUEST_ID,
      expense: makeExpense(),
    })

    applyPendingExpenseResolution({
      groupId: 'g1',
      clientId: record.clientId,
      outcome: 'failed',
    })
    const { result: failed } = renderHook(() => usePendingExpenses('g1'))
    expect(failed.current.map((row) => row.status)).toEqual(['failed'])

    applyPendingExpenseResolution({
      groupId: 'g1',
      clientId: record.clientId,
      outcome: 'sent',
    })
    const { result: sent } = renderHook(() => usePendingExpenses('g1'))
    expect(sent.current).toEqual([])

    // Unknown ids stay no-ops.
    applyPendingExpenseResolution({
      groupId: 'g1',
      clientId: 'pending-missing',
      outcome: 'sent',
    })
    applyPendingExpenseResolution({
      groupId: 'unknown-group',
      clientId: record.clientId,
      outcome: 'failed',
    })
  })
})
