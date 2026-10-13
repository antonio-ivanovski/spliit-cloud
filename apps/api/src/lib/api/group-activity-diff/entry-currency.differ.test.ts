import { describe, expect, it } from 'vitest'

import { entryCurrencyDiffer } from './entry-currency.differ'
import type { DiffableGroup } from './types'

function makeGroup(overrides: Partial<DiffableGroup> = {}): DiffableGroup {
  return {
    name: 'Test Group',
    information: null,
    currency: '£',
    currencyCode: 'GBP',
    defaultEntryCurrencyCode: null,
    timeZone: 'UTC',
    ...overrides,
  }
}

describe('entryCurrencyDiffer', () => {
  it('check returns false when both use the settlement currency', () => {
    expect(entryCurrencyDiffer.check(makeGroup(), makeGroup())).toBe(false)
  })
  it('check returns true when the entry currency changes', () => {
    expect(
      entryCurrencyDiffer.check(
        makeGroup({ defaultEntryCurrencyCode: 'EUR' }),
        makeGroup({ defaultEntryCurrencyCode: 'USD' }),
      ),
    ).toBe(true)
  })
  it('check returns true when the entry currency is set or cleared', () => {
    expect(
      entryCurrencyDiffer.check(
        makeGroup(),
        makeGroup({ defaultEntryCurrencyCode: 'EUR' }),
      ),
    ).toBe(true)
    expect(
      entryCurrencyDiffer.check(
        makeGroup({ defaultEntryCurrencyCode: 'EUR' }),
        makeGroup(),
      ),
    ).toBe(true)
  })
  it('diff returns null when unchanged', () => {
    expect(entryCurrencyDiffer.diff(makeGroup(), makeGroup(), {})).toBeNull()
  })
  it('diff resolves a null entry to the settlement code for display', () => {
    const result = entryCurrencyDiffer.diff(
      makeGroup(),
      makeGroup({ defaultEntryCurrencyCode: 'EUR' }),
      {},
    )
    expect(result).toEqual({
      field: 'defaultEntryCurrencyCode',
      before: 'GBP',
      after: 'EUR',
    })
  })
  it('field is "defaultEntryCurrencyCode"', () => {
    expect(entryCurrencyDiffer.field).toBe('defaultEntryCurrencyCode')
  })
})
