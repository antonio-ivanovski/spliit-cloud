import {
  getFocusedRouteMeta,
  isFocusedMobilePath,
  isMobileGroupNavPath,
  shouldHideMobileGroupTabs,
} from '@/components/mobile-shell'
import { describe, expect, it } from 'vitest'

const translate = (key: string) => key

describe('mobile shell route policy', () => {
  it('classifies focused flows without treating group tabs as focused', () => {
    expect(isFocusedMobilePath('/groups/create')).toBe(true)
    expect(isFocusedMobilePath('/groups/import')).toBe(true)
    expect(isFocusedMobilePath('/groups/demo/expenses/create')).toBe(true)
    expect(isFocusedMobilePath('/groups/demo/expenses/123/edit')).toBe(true)
    expect(isFocusedMobilePath('/groups/demo/edit')).toBe(true)
    expect(isFocusedMobilePath('/account/settings')).toBe(true)
    expect(isFocusedMobilePath('/groups/demo/expenses')).toBe(false)
    expect(isFocusedMobilePath('/groups/demo/stats')).toBe(false)
  })

  it('keeps the mobile group navigation on settings', () => {
    expect(isMobileGroupNavPath('/groups/demo/edit')).toBe(true)
    expect(isMobileGroupNavPath('/groups/demo/expenses')).toBe(true)
    expect(isMobileGroupNavPath('/groups/demo/expenses/123/edit')).toBe(false)
  })

  it('hides desktop group tabs for expense detail and edit routes', () => {
    expect(shouldHideMobileGroupTabs('/groups/demo/expenses/123')).toBe(true)
    expect(shouldHideMobileGroupTabs('/groups/demo/expenses/123/edit')).toBe(
      true,
    )
    expect(shouldHideMobileGroupTabs('/groups/demo/expenses')).toBe(true)
  })

  it('keeps deterministic back destinations for focused routes', () => {
    expect(getFocusedRouteMeta('/groups/create', translate)).toEqual({
      title: 'Groups.createGroupCard.title',
      backHref: '/',
    })
    expect(
      getFocusedRouteMeta('/groups/demo/expenses/123/edit', translate),
    ).toEqual({
      title: 'ExpensePreview.edit',
      backHref: '/groups/demo/expenses',
    })
    expect(
      getFocusedRouteMeta('/groups/bulk-categorize/demo', translate),
    ).toEqual({
      title: 'BulkCategorize.title',
      backHref: '/groups/demo/expenses',
    })
  })
})
