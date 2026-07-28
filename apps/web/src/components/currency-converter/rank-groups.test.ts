import { describe, expect, it } from 'vitest'

import type { AccountGroup } from '@/app/groups/group-buckets'

import { rankGroupsForConverter } from './rank-groups'

function makeGroup(
  overrides: Partial<AccountGroup> & { id: string },
): AccountGroup {
  return {
    name: `Group ${overrides.id}`,
    groupType: 'GROUP',
    archived: false,
    createdAt: '2025-01-01T00:00:00.000Z',
    ledger: { currency: '$', currencyCode: 'USD' },
    financialSummary: {
      expenseCount: 0,
      netBalance: null,
      state: 'NO_EXPENSES',
      latestExpenseCreatedAt: null,
    },
    preference: { starred: false, hidden: false },
    ...overrides,
  } as AccountGroup
}

describe('rankGroupsForConverter', () => {
  it('excludes hidden groups', () => {
    const groups = [
      makeGroup({ id: 'a', preference: { starred: false, hidden: true } }),
      makeGroup({ id: 'b' }),
    ]
    const result = rankGroupsForConverter(groups, 'USD')
    expect(result.map((g) => g.id)).toEqual(['b'])
  })

  it('excludes archived groups', () => {
    const groups = [
      makeGroup({ id: 'a', archived: true }),
      makeGroup({ id: 'b' }),
    ]
    const result = rankGroupsForConverter(groups, 'USD')
    expect(result.map((g) => g.id)).toEqual(['b'])
  })

  it('excludes groups with null currencyCode (custom currency)', () => {
    const groups = [
      makeGroup({ id: 'a', ledger: { currency: '⭐', currencyCode: null } }),
      makeGroup({ id: 'b', ledger: { currency: '€', currencyCode: 'EUR' } }),
    ]
    const result = rankGroupsForConverter(groups, 'EUR')
    expect(result.map((g) => g.id)).toEqual(['b'])
  })

  it('excludes groups with empty currencyCode', () => {
    const groups = [
      makeGroup({ id: 'a', ledger: { currency: '', currencyCode: '' } }),
      makeGroup({ id: 'b', ledger: { currency: '€', currencyCode: 'EUR' } }),
    ]
    const result = rankGroupsForConverter(groups, 'EUR')
    expect(result.map((g) => g.id)).toEqual(['b'])
  })

  it('places starred groups first regardless of type', () => {
    const groups = [
      makeGroup({
        id: 'friend',
        groupType: 'FRIEND',
        preference: { starred: true, hidden: false },
      }),
      makeGroup({ id: 'group', groupType: 'GROUP' }),
    ]
    const result = rankGroupsForConverter(groups, 'USD')
    expect(result.map((g) => g.id)).toEqual(['friend', 'group'])
  })

  it('places groups before friends within non-starred', () => {
    const groups = [
      makeGroup({ id: 'friend', groupType: 'FRIEND' }),
      makeGroup({ id: 'group', groupType: 'GROUP' }),
    ]
    const result = rankGroupsForConverter(groups, 'USD')
    expect(result.map((g) => g.id)).toEqual(['group', 'friend'])
  })

  it('boosts source-currency match within a tier', () => {
    const groups = [
      makeGroup({
        id: 'eur',
        ledger: { currency: '€', currencyCode: 'EUR' },
        createdAt: '2025-06-01T00:00:00.000Z',
      }),
      makeGroup({
        id: 'usd',
        ledger: { currency: '$', currencyCode: 'USD' },
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    ]
    const result = rankGroupsForConverter(groups, 'USD')
    expect(result.map((g) => g.id)).toEqual(['usd', 'eur'])
  })

  it('sorts by latestExpenseCreatedAt desc within same tier and currency match', () => {
    const groups = [
      makeGroup({
        id: 'old',
        financialSummary: {
          expenseCount: 1,
          netBalance: null,
          state: 'NO_EXPENSES',
          latestExpenseCreatedAt: '2025-01-01T00:00:00.000Z',
        },
      }),
      makeGroup({
        id: 'new',
        financialSummary: {
          expenseCount: 1,
          netBalance: null,
          state: 'NO_EXPENSES',
          latestExpenseCreatedAt: '2025-06-01T00:00:00.000Z',
        },
      }),
    ]
    const result = rankGroupsForConverter(groups, 'USD')
    expect(result.map((g) => g.id)).toEqual(['new', 'old'])
  })

  it('tie-breaks by id ascending', () => {
    const groups = [
      makeGroup({ id: 'b', createdAt: '2025-01-01T00:00:00.000Z' }),
      makeGroup({ id: 'a', createdAt: '2025-01-01T00:00:00.000Z' }),
    ]
    const result = rankGroupsForConverter(groups, 'USD')
    expect(result.map((g) => g.id)).toEqual(['a', 'b'])
  })

  it('starred tier beats source-currency boost in non-starred tier', () => {
    const groups = [
      makeGroup({
        id: 'starred-eur',
        ledger: { currency: '€', currencyCode: 'EUR' },
        preference: { starred: true, hidden: false },
      }),
      makeGroup({
        id: 'regular-usd',
        ledger: { currency: '$', currencyCode: 'USD' },
      }),
    ]
    const result = rankGroupsForConverter(groups, 'USD')
    expect(result.map((g) => g.id)).toEqual(['starred-eur', 'regular-usd'])
  })
})
