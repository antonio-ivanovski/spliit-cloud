import { describe, expect, it } from 'vitest'

import {
  buildActivityReturnTo,
  expenseEditListLink,
  expenseEditPreviewLink,
  expenseEditSearch,
  getActivitySearch,
  getGlobalExpensesSearch,
  isActivityReturnTo,
  isGlobalExpensesReturnTo,
} from './expense-navigation'

describe('global expense return navigation', () => {
  it('restores the filtered feed search from an internal path', () => {
    expect(
      getGlobalExpensesSearch('/expenses?q=dinner&groups=group-1'),
    ).toEqual({ q: 'dinner', groups: 'group-1' })
    expect(isGlobalExpensesReturnTo('/expenses')).toBe(true)
  })

  it('rejects external and unrelated paths', () => {
    expect(getGlobalExpensesSearch('https://example.com/expenses')).toBe(
      undefined,
    )
    expect(getGlobalExpensesSearch('/groups/group-1/expenses')).toBe(undefined)
    expect(isGlobalExpensesReturnTo('/expenses#external')).toBe(false)
  })
})

describe('activity return navigation', () => {
  it('recognizes the activity tab as a return destination', () => {
    expect(isActivityReturnTo('/groups/grp-1/activity')).toBe(true)
    expect(isActivityReturnTo('/groups/grp-1/activity?expenseId=exp-1')).toBe(
      true,
    )
    expect(isActivityReturnTo('/groups/grp-1/expenses')).toBe(false)
    expect(isActivityReturnTo('/expenses')).toBe(false)
    expect(isActivityReturnTo('https://example.com/groups/a/activity')).toBe(
      false,
    )
  })

  it('builds the activity list return path', () => {
    expect(buildActivityReturnTo('grp-1')).toBe('/groups/grp-1/activity')
    expect(buildActivityReturnTo('grp-1', 'true')).toBe(
      '/groups/grp-1/activity?actShowAll=true',
    )
    expect(buildActivityReturnTo('grp-1', 'false')).toBe(
      '/groups/grp-1/activity',
    )
  })

  it('restores the activity search from an internal path', () => {
    expect(getActivitySearch('/groups/grp-1/activity?actShowAll=true')).toEqual(
      { actShowAll: 'true' },
    )
    expect(getActivitySearch('/groups/grp-1/activity')).toEqual({})
    expect(getActivitySearch('https://example.com/groups/a/activity')).toBe(
      undefined,
    )
    expect(getActivitySearch('/groups/grp-1/expenses')).toBe(undefined)
  })

  it('preserves the activity view mode across the edit round-trip', () => {
    expect(
      expenseEditPreviewLink(
        'grp-1',
        'exp-1',
        '/groups/grp-1/activity?actShowAll=true',
      ),
    ).toMatchObject({
      to: '/groups/$groupId/activity',
      params: { groupId: 'grp-1' },
      search: { expenseId: 'exp-1', actShowAll: 'true' },
    })

    const list = expenseEditListLink(
      'grp-1',
      '/groups/grp-1/activity?actShowAll=true',
    )
    const kept = (
      list.search as (
        search: Record<string, unknown>,
      ) => Record<string, unknown>
    )({
      expenseId: 'exp-1',
      returnTo: '/groups/grp-1/activity?actShowAll=true',
    })
    expect(kept).toMatchObject({ actShowAll: 'true' })
    expect(kept.expenseId).toBeUndefined()
    expect(kept.returnTo).toBeUndefined()
  })

  it('keeps scope and returnTo isolated on the edit route', () => {
    const search = expenseEditSearch(
      undefined,
      '/groups/grp-1/activity',
    ) as () => Record<string, unknown>
    expect(search()).toEqual({
      scope: undefined,
      returnTo: '/groups/grp-1/activity',
    })
  })

  it('returns from activity editing to the activity preview and list', () => {
    expect(
      expenseEditPreviewLink('grp-1', 'exp-1', '/groups/grp-1/activity'),
    ).toMatchObject({
      to: '/groups/$groupId/activity',
      params: { groupId: 'grp-1' },
      search: { expenseId: 'exp-1' },
      resetScroll: false,
    })

    const list = expenseEditListLink('grp-1', '/groups/grp-1/activity')
    expect(list).toMatchObject({
      to: '/groups/$groupId/activity',
      params: { groupId: 'grp-1' },
      resetScroll: false,
    })
    const cleared = (
      list.search as (
        search: Record<string, unknown>,
      ) => Record<string, unknown>
    )({ expenseId: 'exp-1', returnTo: '/groups/grp-1/activity' })
    expect(cleared.expenseId).toBeUndefined()
    expect(cleared.returnTo).toBeUndefined()
  })
})
