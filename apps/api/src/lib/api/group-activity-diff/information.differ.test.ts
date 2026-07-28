import { describe, expect, it } from 'vitest'

import { informationDiffer } from './information.differ'
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

describe('informationDiffer', () => {
  it('check returns false for identical null', () => {
    expect(
      informationDiffer.check(
        makeGroup({ information: null }),
        makeGroup({ information: null }),
      ),
    ).toBe(false)
  })
  it('check returns false for identical text', () => {
    expect(
      informationDiffer.check(
        makeGroup({ information: 'Desc' }),
        makeGroup({ information: 'Desc' }),
      ),
    ).toBe(false)
  })
  it('check returns true when null becomes text', () => {
    expect(
      informationDiffer.check(
        makeGroup({ information: null }),
        makeGroup({ information: 'Added' }),
      ),
    ).toBe(true)
  })
  it('check returns true when text becomes null', () => {
    expect(
      informationDiffer.check(
        makeGroup({ information: 'Removed' }),
        makeGroup({ information: null }),
      ),
    ).toBe(true)
  })
  it('check returns true when text changes', () => {
    expect(
      informationDiffer.check(
        makeGroup({ information: 'Old' }),
        makeGroup({ information: 'New' }),
      ),
    ).toBe(true)
  })
  it('diff returns null for identical', () => {
    expect(
      informationDiffer.diff(
        makeGroup({ information: 'Desc' }),
        makeGroup({ information: 'Desc' }),
        {},
      ),
    ).toBeNull()
  })
  it('diff null before when added', () => {
    const result = informationDiffer.diff(
      makeGroup({ information: null }),
      makeGroup({ information: 'Added desc' }),
      {},
    )
    expect(result).toEqual({
      field: 'information',
      before: null,
      after: 'Added desc',
    })
  })
  it('diff null after when removed', () => {
    const result = informationDiffer.diff(
      makeGroup({ information: 'Old desc' }),
      makeGroup({ information: null }),
      {},
    )
    expect(result).toEqual({
      field: 'information',
      before: 'Old desc',
      after: null,
    })
  })
  it('diff both values when changed', () => {
    const result = informationDiffer.diff(
      makeGroup({ information: 'Old' }),
      makeGroup({ information: 'New' }),
      {},
    )
    expect(result).toEqual({
      field: 'information',
      before: 'Old',
      after: 'New',
    })
  })
  it('field is "information"', () => {
    expect(informationDiffer.field).toBe('information')
  })
})
