import { describe, expect, it } from 'vitest'
import {
  QUERY_CACHE_BUSTER,
  QUERY_CACHE_MAX_AGE,
  shouldDehydrateReadQuery,
  shouldPersistQueryKey,
} from './query-persistence'

describe('query persistence allowlist', () => {
  it('keeps the supported read procedures', () => {
    expect(
      shouldPersistQueryKey([['account', 'groups'], { type: 'query' }]),
    ).toBe(true)
    expect(shouldPersistQueryKey([['groups', 'get'], { type: 'query' }])).toBe(
      true,
    )
    expect(
      shouldPersistQueryKey([
        ['groups', 'expenses', 'get'],
        {
          type: 'query',
          input: { groupId: 'group-1', expenseId: 'expense-1' },
        },
      ]),
    ).toBe(true)
    expect(
      shouldPersistQueryKey([
        ['groups', 'get'],
        {
          type: 'query',
          input: { groupId: 'group-1', linkInviteToken: 'secret' },
        },
      ]),
    ).toBe(false)
    expect(
      shouldPersistQueryKey([
        ['groups', 'expenses', 'list'],
        {
          type: 'infinite',
          input: { groupId: 'group-1', linkInviteToken: 'secret' },
        },
      ]),
    ).toBe(false)
    expect(
      shouldPersistQueryKey([
        ['groups', 'expenses', 'list'],
        { type: 'infinite', input: { groupId: 'group-1' } },
      ]),
    ).toBe(true)
  })

  it('rejects other procedures and malformed keys', () => {
    expect(
      shouldPersistQueryKey([['groups', 'getDetails'], { type: 'query' }]),
    ).toBe(false)
    expect(shouldPersistQueryKey([['account', 'groups', 'preferences']])).toBe(
      false,
    )
    expect(
      shouldPersistQueryKey([['groups', 'get'], { type: 'mutation' }]),
    ).toBe(false)
    expect(shouldPersistQueryKey(['groups.get'])).toBe(false)
    expect(shouldPersistQueryKey([])).toBe(false)
  })

  it('only dehydrates successful reads', () => {
    const queryKey = [['groups', 'get'], { type: 'query' }] as const
    expect(
      shouldDehydrateReadQuery({ queryKey, state: { status: 'success' } }),
    ).toBe(true)
    expect(
      shouldDehydrateReadQuery({ queryKey, state: { status: 'pending' } }),
    ).toBe(false)
    expect(
      shouldDehydrateReadQuery({
        queryKey: [['groups', 'getDetails']],
        state: { status: 'success' },
      }),
    ).toBe(false)
  })
})

describe('query persistence policy', () => {
  it('uses a versioned cache with a bounded lifetime', () => {
    expect(QUERY_CACHE_BUSTER).toMatch(/^read-cache-/)
    expect(QUERY_CACHE_MAX_AGE).toBe(30 * 24 * 60 * 60 * 1000)
  })
})
