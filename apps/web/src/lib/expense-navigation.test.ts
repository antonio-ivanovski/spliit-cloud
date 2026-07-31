import { describe, expect, it } from 'vitest'

import {
  getGlobalExpensesSearch,
  isGlobalExpensesReturnTo,
} from './expense-navigation'

describe('global expense return navigation', () => {
  it('restores the filtered feed search from an internal path', () => {
    expect(
      getGlobalExpensesSearch('/expenses?q=dinner&groups=group-1'),
    ).toEqual({ q: 'dinner', groups: 'group-1' })
    expect(isGlobalExpensesReturnTo('/expenses')).toBe(true)
  })

  it('rejects external and unrelated paths', () => {
    expect(getGlobalExpensesSearch('https://example.com/expenses')).toBe(
      undefined,
    )
    expect(getGlobalExpensesSearch('/groups/group-1/expenses')).toBe(undefined)
    expect(isGlobalExpensesReturnTo('/expenses#external')).toBe(false)
  })
})
