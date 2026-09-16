import { describe, expect, it } from 'vitest'

import {
  isExpenseInvolvingUser,
  type InvolvementExpense,
} from '../expense-involvement'

function expense(
  paidByIds: string[],
  paidForIds: string[],
  accountByParticipant?: Record<string, string>,
): InvolvementExpense {
  const side = (id: string) => ({
    ledgerParticipant: {
      id,
      account: accountByParticipant?.[id]
        ? { id: accountByParticipant[id] }
        : null,
    },
  })
  return { paidByList: paidByIds.map(side), paidFor: paidForIds.map(side) }
}

describe('isExpenseInvolvingUser', () => {
  it('matches the payer by participant id', () => {
    expect(isExpenseInvolvingUser(expense(['p1'], ['p2']), 'p1', 'a9')).toBe(
      true,
    )
  })

  it('matches a beneficiary by participant id', () => {
    expect(isExpenseInvolvingUser(expense(['p1'], ['p2']), 'p2', 'a9')).toBe(
      true,
    )
  })

  it('falls back to the backing account id', () => {
    const e = expense(['p1'], ['p2'], { p2: 'my-account' })
    expect(isExpenseInvolvingUser(e, 'other-participant', 'my-account')).toBe(
      true,
    )
  })

  it('returns false when neither participant nor account matches', () => {
    const e = expense(['p1'], ['p2'], { p1: 'a1', p2: 'a2' })
    expect(isExpenseInvolvingUser(e, 'p3', 'a3')).toBe(false)
  })

  it('returns true when no identity is known (cannot determine involvement)', () => {
    expect(isExpenseInvolvingUser(expense(['p1'], ['p2']), null, null)).toBe(
      true,
    )
    expect(
      isExpenseInvolvingUser(expense(['p1'], ['p2']), undefined, undefined),
    ).toBe(true)
  })
})
