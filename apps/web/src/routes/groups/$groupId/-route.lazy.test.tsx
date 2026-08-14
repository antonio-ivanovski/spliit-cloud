// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest'

import { getLegacyGroupAliasHref } from './route.lazy'

describe('getLegacyGroupAliasHref', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/')
    window.sessionStorage.clear()
    window.localStorage.clear()
  })

  it('converts a legacy public fragment while preserving the nested route', () => {
    window.history.replaceState(
      null,
      '',
      '/groups/canonical/expenses/expense-1#view=public-alias',
    )

    expect(getLegacyGroupAliasHref('canonical')).toBe(
      '/groups/public-alias/expenses/expense-1',
    )
    expect(window.sessionStorage.length).toBe(0)
    expect(window.localStorage.length).toBe(0)
  })

  it('converts legacy invitation query and fragment links', () => {
    window.history.replaceState(
      null,
      '',
      '/groups/canonical/balances?invite=query-alias&view=visual',
    )
    expect(getLegacyGroupAliasHref('canonical')).toBe(
      '/groups/query-alias/balances?view=visual',
    )

    window.history.replaceState(
      null,
      '',
      '/groups/canonical#invite=fragment-alias',
    )
    expect(getLegacyGroupAliasHref('canonical')).toBe('/groups/fragment-alias')
  })
})
