import { describe, expect, it, vi } from 'vitest'

import '../../test/mocks'
import {
  buildRecurrenceNeighborMap,
  loadOfflineCatalog,
  offlineTxOptions,
} from './offline'

describe('offline transaction consistency', () => {
  it('uses RepeatableRead with 30s timeout', () => {
    expect(offlineTxOptions).toEqual({
      isolationLevel: 'RepeatableRead',
      timeout: 30_000,
    })
  })

  it('builds neighbor chains excluding null sequences', () => {
    const map = buildRecurrenceNeighborMap([
      { id: 'a', recurrenceSequence: 1 },
      { id: 'b', recurrenceSequence: 2 },
      { id: 'c', recurrenceSequence: null },
      { id: 'd', recurrenceSequence: 3 },
    ])
    expect(map.get('a')).toEqual({
      previousExpenseId: null,
      nextExpenseId: 'b',
    })
    expect(map.get('b')).toEqual({
      previousExpenseId: 'a',
      nextExpenseId: 'd',
    })
    expect(map.get('d')).toEqual({
      previousExpenseId: 'b',
      nextExpenseId: null,
    })
    expect(map.get('c')).toEqual({
      previousExpenseId: null,
      nextExpenseId: null,
    })
  })

  it('routes every catalog query through the passed transaction', async () => {
    const tx = {
      groupMember: { findMany: vi.fn(async () => []) },
      accountGroupPreference: { findMany: vi.fn(async () => []) },
      groupInvitation: { findMany: vi.fn(async () => []) },
      expense: { findMany: vi.fn(async () => []) },
    }
    await loadOfflineCatalog(tx as never, 'acct-1')
    expect(tx.groupMember.findMany).toHaveBeenCalled()
    expect(tx.accountGroupPreference.findMany).toHaveBeenCalled()
    expect(tx.expense.findMany).not.toHaveBeenCalled()
  })
})
