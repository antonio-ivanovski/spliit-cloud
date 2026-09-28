import { describe, expect, it } from 'vitest'

import { getVisibleGroupTabs } from './group-tabs'

describe('getVisibleGroupTabs', () => {
  it('orders activity and members before stats and budgets by default', () => {
    expect(
      getVisibleGroupTabs(null, {
        isFriendLedger: false,
        canViewSettings: true,
      }),
    ).toEqual([
      'expenses',
      'balances',
      'activity',
      'members',
      'stats',
      'budgets',
      'tools',
      'edit',
    ])
  })

  it('treats an empty stored order as the default', () => {
    expect(
      getVisibleGroupTabs([], {
        isFriendLedger: false,
        canViewSettings: true,
      }),
    ).toEqual([
      'expenses',
      'balances',
      'activity',
      'members',
      'stats',
      'budgets',
      'tools',
      'edit',
    ])
  })

  it('honours a custom account order and appends missing tabs', () => {
    expect(
      getVisibleGroupTabs(['tools', 'expenses'], {
        isFriendLedger: false,
        canViewSettings: true,
      }),
    ).toEqual([
      'tools',
      'expenses',
      'balances',
      'activity',
      'members',
      'stats',
      'budgets',
      'edit',
    ])
  })

  it('hides members on friend ledgers', () => {
    expect(
      getVisibleGroupTabs(null, {
        isFriendLedger: true,
        canViewSettings: true,
      }),
    ).not.toContain('members')
  })

  it('hides settings without a viewer', () => {
    expect(
      getVisibleGroupTabs(null, {
        isFriendLedger: false,
        canViewSettings: false,
      }),
    ).not.toContain('edit')
  })

  it('removes account-hidden tabs but never expenses or settings', () => {
    const visibility = { isFriendLedger: false, canViewSettings: true }
    expect(getVisibleGroupTabs(null, visibility, ['stats', 'budgets'])).toEqual(
      ['expenses', 'balances', 'activity', 'members', 'tools', 'edit'],
    )
    // Defensive: crafted values cannot hide the landing or settings tabs.
    expect(
      getVisibleGroupTabs(null, visibility, ['expenses', 'edit', 'overview']),
    ).toEqual([
      'expenses',
      'balances',
      'activity',
      'members',
      'stats',
      'budgets',
      'tools',
      'edit',
    ])
  })
})
