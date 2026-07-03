import { describe, expect, it } from 'vitest'
import { currencyDiffer } from './currency.differ'
import type { DiffableGroup } from './types'

function makeGroup(overrides: Partial<DiffableGroup> = {}): DiffableGroup {
  return {
    name: 'Test Group',
    information: null,
    currency: '$',
    currencyCode: 'USD',
    ...overrides,
  }
}

describe('currencyDiffer', () => {
  it('check returns false for identical currency and code', () => {
    expect(currencyDiffer.check(makeGroup(), makeGroup())).toBe(false)
  })
  it('check returns true when currency changes', () => {
    expect(
      currencyDiffer.check(
        makeGroup({ currency: '$' }),
        makeGroup({ currency: '€' }),
      ),
    ).toBe(true)
  })
  it('check returns true when code changes', () => {
    expect(
      currencyDiffer.check(
        makeGroup({ currencyCode: 'USD' }),
        makeGroup({ currencyCode: 'EUR' }),
      ),
    ).toBe(true)
  })
  it('check returns true when both change', () => {
    expect(
      currencyDiffer.check(
        makeGroup({ currency: '$', currencyCode: 'USD' }),
        makeGroup({ currency: '€', currencyCode: 'EUR' }),
      ),
    ).toBe(true)
  })
  it('diff returns null when unchanged', () => {
    expect(currencyDiffer.diff(makeGroup(), makeGroup(), {} as any)).toBeNull()
  })
  it('diff formats with code and symbol', () => {
    const result = currencyDiffer.diff(
      makeGroup({ currency: '$', currencyCode: 'USD' }),
      makeGroup({ currency: '€', currencyCode: 'EUR' }),
      {} as any,
    )
    expect(result).toEqual({
      field: 'currency',
      before: 'USD ($)',
      after: 'EUR (€)',
    })
  })
  it('diff falls back to symbol when code is null', () => {
    const result = currencyDiffer.diff(
      makeGroup({ currency: '£', currencyCode: null }),
      makeGroup({ currency: '€', currencyCode: 'EUR' }),
      {} as any,
    )
    expect(result).toEqual({ field: 'currency', before: '£', after: 'EUR (€)' })
  })
  it('diff handles both codes null', () => {
    const result = currencyDiffer.diff(
      makeGroup({ currency: '$', currencyCode: null }),
      makeGroup({ currency: '€', currencyCode: null }),
      {} as any,
    )
    expect(result).toEqual({ field: 'currency', before: '$', after: '€' })
  })
  it('diff handles same code different symbol', () => {
    const result = currencyDiffer.diff(
      makeGroup({ currency: '$', currencyCode: 'USD' }),
      makeGroup({ currency: 'US$', currencyCode: 'USD' }),
      {} as any,
    )
    expect(result).toEqual({
      field: 'currency',
      before: 'USD ($)',
      after: 'USD (US$)',
    })
  })
  it('field is "currency"', () => {
    expect(currencyDiffer.field).toBe('currency')
  })
})
