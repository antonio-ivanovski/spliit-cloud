import { describe, expect, it } from 'vitest'
import { getGroupChangeSummary, getGroupChangedFields } from './index'
import type { DiffableGroup, GroupChangeContext } from './types'

function makeGroup(overrides: Partial<DiffableGroup> = {}): DiffableGroup {
  return {
    name: 'Test Group',
    information: null,
    currency: '$',
    currencyCode: 'USD',
    ...overrides,
  }
}

const ctx: GroupChangeContext = {}

describe('getGroupChangedFields', () => {
  it('returns null for identical groups', () => {
    expect(getGroupChangedFields(makeGroup(), makeGroup())).toBeNull()
  })

  it('detects name change', () => {
    expect(
      getGroupChangedFields(makeGroup({ name: 'A' }), makeGroup({ name: 'B' })),
    ).toEqual(['name'])
  })

  it('detects information change', () => {
    expect(
      getGroupChangedFields(
        makeGroup({ information: null }),
        makeGroup({ information: 'Desc' }),
      ),
    ).toEqual(['information'])
    expect(
      getGroupChangedFields(
        makeGroup({ information: 'Old' }),
        makeGroup({ information: 'New' }),
      ),
    ).toEqual(['information'])
  })

  it('detects currency change (symbol only)', () => {
    expect(
      getGroupChangedFields(
        makeGroup({ currency: '$' }),
        makeGroup({ currency: '€' }),
      ),
    ).toEqual(['currency'])
  })

  it('detects currency code change', () => {
    expect(
      getGroupChangedFields(
        makeGroup({ currencyCode: 'USD' }),
        makeGroup({ currencyCode: 'EUR' }),
      ),
    ).toEqual(['currency'])
  })

  it('reports multiple changed fields', () => {
    const result = getGroupChangedFields(
      makeGroup({ name: 'Old', currency: '$', currencyCode: 'USD' }),
      makeGroup({ name: 'New', currency: '€', currencyCode: 'EUR' }),
    )
    expect(result).toEqual(expect.arrayContaining(['name', 'currency']))
    expect(result).not.toContain('information')
  })
})

describe('getGroupChangeSummary', () => {
  it('returns null for identical groups', () => {
    expect(getGroupChangeSummary(makeGroup(), makeGroup(), ctx)).toBeNull()
  })

  it('produces name before/after', () => {
    const result = getGroupChangeSummary(
      makeGroup({ name: 'Old' }),
      makeGroup({ name: 'New' }),
      ctx,
    )
    expect(result).not.toBeNull()
    expect(result!.changedFields).toEqual(['name'])
    expect(result!.changes).toEqual([
      { field: 'name', before: 'Old', after: 'New' },
    ])
  })

  it('produces information before/after (added)', () => {
    const result = getGroupChangeSummary(
      makeGroup({ information: null }),
      makeGroup({ information: 'New desc' }),
      ctx,
    )
    expect(result).not.toBeNull()
    expect(result!.changes.find((c) => c.field === 'information')).toEqual({
      field: 'information',
      before: null,
      after: 'New desc',
    })
  })

  it('produces currency before/after', () => {
    const result = getGroupChangeSummary(
      makeGroup({ currency: '$', currencyCode: 'USD' }),
      makeGroup({ currency: '€', currencyCode: 'EUR' }),
      ctx,
    )
    expect(result).not.toBeNull()
    expect(result!.changes.find((c) => c.field === 'currency')).toEqual({
      field: 'currency',
      before: 'USD ($)',
      after: 'EUR (€)',
    })
  })

  it('returns all changes', () => {
    const result = getGroupChangeSummary(
      makeGroup({
        name: 'Old',
        information: 'Old info',
        currency: '$',
        currencyCode: 'USD',
      }),
      makeGroup({
        name: 'New',
        information: 'New info',
        currency: '€',
        currencyCode: 'EUR',
      }),
      ctx,
    )
    expect(result).not.toBeNull()
    expect(result!.changedFields).toHaveLength(3)
    expect(result!.changes).toHaveLength(3)
  })
})
