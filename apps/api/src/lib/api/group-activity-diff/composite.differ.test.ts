import { describe, expect, it } from 'vitest'

import { compositeGroupDiffer } from './composite.differ'
import { currencyDiffer } from './currency.differ'
import { informationDiffer } from './information.differ'
import { nameDiffer } from './name.differ'
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

function fullDiffer() {
  return compositeGroupDiffer([nameDiffer, informationDiffer, currencyDiffer])
}

describe('compositeGroupDiffer', () => {
  describe('changedFields', () => {
    it('returns null when nothing changed', () => {
      expect(fullDiffer().changedFields(makeGroup(), makeGroup())).toBeNull()
    })

    it('returns all field names that differ', () => {
      const result = fullDiffer().changedFields(
        makeGroup({ name: 'Old', currency: '$', currencyCode: 'USD' }),
        makeGroup({ name: 'New', currency: '€', currencyCode: 'EUR' }),
      )
      expect(result).toEqual(expect.arrayContaining(['name', 'currency']))
      expect(result).not.toContain('information')
    })

    it('returns fields in registration order', () => {
      const composite = compositeGroupDiffer([nameDiffer, currencyDiffer])
      expect(
        composite.changedFields(
          makeGroup({ name: 'A', currency: '$' }),
          makeGroup({ name: 'B', currency: '€' }),
        ),
      ).toEqual(['name', 'currency'])
    })

    it('works with a subset of differs', () => {
      const composite = compositeGroupDiffer([nameDiffer])
      expect(
        composite.changedFields(
          makeGroup({ name: 'X' }),
          makeGroup({ name: 'Y' }),
        ),
      ).toEqual(['name'])
      expect(
        composite.changedFields(
          makeGroup({ currency: '$' }),
          makeGroup({ currency: '€' }),
        ),
      ).toBeNull()
    })
  })

  describe('changeSummary', () => {
    it('returns null when nothing changed', () => {
      expect(
        fullDiffer().changeSummary(makeGroup(), makeGroup(), ctx),
      ).toBeNull()
    })

    it('returns all diff emissions for changed fields', () => {
      const result = fullDiffer().changeSummary(
        makeGroup({
          name: 'Old',
          information: 'Old info',
          currency: '£',
          currencyCode: 'GBP',
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
      expect(result!.length).toBe(3)
      expect(result!.find((d) => d.field === 'name')).toEqual({
        field: 'name',
        before: 'Old',
        after: 'New',
      })
      expect(result!.find((d) => d.field === 'information')).toEqual({
        field: 'information',
        before: 'Old info',
        after: 'New info',
      })
      expect(result!.find((d) => d.field === 'currency')).toEqual({
        field: 'currency',
        before: 'GBP (£)',
        after: 'EUR (€)',
      })
    })

    it('returns partial emissions', () => {
      const result = fullDiffer().changeSummary(
        makeGroup({ name: 'A', currency: '$' }),
        makeGroup({ name: 'B', currency: '$' }),
        ctx,
      )
      expect(result).not.toBeNull()
      expect(result!.length).toBe(1)
      expect(result![0].field).toBe('name')
    })

    it('returns null when no field actually changed', () => {
      expect(
        fullDiffer().changeSummary(makeGroup(), makeGroup(), ctx),
      ).toBeNull()
    })
  })

  describe('getDiffers', () => {
    it('returns configured differs', () => {
      const composite = compositeGroupDiffer([nameDiffer])
      expect(composite.getDiffers()).toHaveLength(1)
      expect(composite.getDiffers()[0]).toBe(nameDiffer)
    })
  })
})
