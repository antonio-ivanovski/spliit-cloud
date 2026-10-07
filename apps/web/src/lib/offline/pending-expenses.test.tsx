import { beforeEach, describe, expect, it } from 'vitest'

import { renderHook } from '@/test/test-utils'

import {
  clearPendingExpensesForTests,
  enqueuePendingExpenseForTests,
  usePendingExpenses,
} from './pending-expenses'

describe('usePendingExpenses offline-write seam', () => {
  beforeEach(() => {
    clearPendingExpensesForTests()
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
})
