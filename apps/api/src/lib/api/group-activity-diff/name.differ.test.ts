import { describe, expect, it } from 'vitest'

import { nameDiffer } from './name.differ'
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

describe('nameDiffer', () => {
  it('check returns false for identical names', () => {
    expect(
      nameDiffer.check(makeGroup({ name: 'A' }), makeGroup({ name: 'A' })),
    ).toBe(false)
  })
  it('check returns true for different names', () => {
    expect(
      nameDiffer.check(makeGroup({ name: 'A' }), makeGroup({ name: 'B' })),
    ).toBe(true)
  })
  it('diff returns null when names are identical', () => {
    expect(
      nameDiffer.diff(
        makeGroup({ name: 'Same' }),
        makeGroup({ name: 'Same' }),
        {},
      ),
    ).toBeNull()
  })
  it('diff includes before/after name strings when changed', () => {
    const result = nameDiffer.diff(
      makeGroup({ name: 'Old' }),
      makeGroup({ name: 'New' }),
      {},
    )
    expect(result).toEqual({ field: 'name', before: 'Old', after: 'New' })
  })
  it('field is "name"', () => {
    expect(nameDiffer.field).toBe('name')
  })
})
