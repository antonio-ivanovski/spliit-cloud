import { describe, expect, it } from 'vitest'

import { colorDiffer } from './color.differ'
import type { DiffableGroup } from './types'

function makeGroup(overrides: Partial<DiffableGroup> = {}): DiffableGroup {
  return {
    name: 'Test Group',
    information: null,
    currency: '$',
    currencyCode: 'USD',
    emoji: null,
    color: null,
    ...overrides,
  }
}

describe('colorDiffer', () => {
  it('check returns false for identical colors', () => {
    expect(
      colorDiffer.check(
        makeGroup({ color: 'sky' }),
        makeGroup({ color: 'sky' }),
      ),
    ).toBe(false)
  })

  it('diff includes before/after color strings when changed', () => {
    const result = colorDiffer.diff(
      makeGroup({ color: null }),
      makeGroup({ color: '#ff0000' }),
      {},
    )
    expect(result).toEqual({
      field: 'color',
      before: null,
      after: '#ff0000',
    })
  })

  it('field is "color"', () => {
    expect(colorDiffer.field).toBe('color')
  })
})
