import { describe, expect, it } from 'vitest'

import { emojiDiffer } from './emoji.differ'
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

describe('emojiDiffer', () => {
  it('check returns false for identical emoji', () => {
    expect(
      emojiDiffer.check(makeGroup({ emoji: '🎉' }), makeGroup({ emoji: '🎉' })),
    ).toBe(false)
  })

  it('treats null and empty sentinel as different values', () => {
    expect(
      emojiDiffer.check(makeGroup({ emoji: null }), makeGroup({ emoji: '' })),
    ).toBe(true)
  })

  it('diff includes before/after emoji strings when changed', () => {
    const result = emojiDiffer.diff(
      makeGroup({ emoji: null }),
      makeGroup({ emoji: '🎉' }),
      {},
    )
    expect(result).toEqual({ field: 'emoji', before: null, after: '🎉' })
  })

  it('field is "emoji"', () => {
    expect(emojiDiffer.field).toBe('emoji')
  })
})
