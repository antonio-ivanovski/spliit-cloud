import { describe, expect, it } from 'vitest'
import type { GroupContext } from './context'
import {
  buildGroupContextSection,
  buildLocaleHint,
  buildRecentExpensesSection,
  buildTranslationDirective,
  resolveLanguageName,
} from './prompt'

describe('resolveLanguageName', () => {
  it('returns the native name for known locales', () => {
    expect(resolveLanguageName('es')).toBe('Español')
    expect(resolveLanguageName('en-US')).toBe('English (US)')
    expect(resolveLanguageName('ja-JP')).toBe('日本語')
    expect(resolveLanguageName('zh-CN')).toBe('简体中文')
  })

  it('returns undefined for unknown locales', () => {
    expect(resolveLanguageName('xx')).toBeUndefined()
    expect(resolveLanguageName('')).toBeUndefined()
  })
})

describe('buildLocaleHint', () => {
  it('frames the locale as a soft hint, not a rule', () => {
    const hint = buildLocaleHint('es')
    expect(hint).toContain('Español')
    expect(hint).toContain("user's app language")
    expect(hint).toContain('may be written in')
    expect(hint).toContain('hint, not a rule')
    // Hard requirement markers must NOT appear.
    expect(hint).not.toMatch(/title is in .+/i)
    expect(hint).not.toMatch(/must be written/i)
  })

  it('returns an empty string when no locale is provided', () => {
    expect(buildLocaleHint(undefined)).toBe('')
    expect(buildLocaleHint('')).toBe('')
  })

  it('returns an empty string for unknown locales', () => {
    expect(buildLocaleHint('xx')).toBe('')
  })
})

describe('buildGroupContextSection', () => {
  it('returns an empty string when no group is provided', () => {
    expect(buildGroupContextSection(undefined)).toBe('')
  })

  it('uses the ISO code when currencyCode is present', () => {
    const group: GroupContext = {
      name: 'Trip to Paris',
      currency: '$',
      currencyCode: 'EUR',
    }
    const section = buildGroupContextSection(group)
    expect(section).toContain('Trip to Paris')
    expect(section).toContain('EUR')
    expect(section).not.toContain('"$"')
  })

  it('falls back to the currency symbol when currencyCode is null', () => {
    const group: GroupContext = {
      name: 'Bottle club',
      currency: '⛁',
      currencyCode: null,
    }
    const section = buildGroupContextSection(group)
    expect(section).toContain('Bottle club')
    expect(section).toContain('⛁')
  })
})

describe('buildRecentExpensesSection', () => {
  it('returns an empty string for no expenses', () => {
    expect(buildRecentExpensesSection([])).toBe('')
  })

  it('renders each pair as "title" -> categoryId', () => {
    const section = buildRecentExpensesSection([
      { title: 'Groceries', categoryId: 'groceries' },
      { title: 'Uber', categoryId: 'taxi' },
    ])
    expect(section).toContain('"Groceries" -> groceries')
    expect(section).toContain('"Uber" -> taxi')
    expect(section).toContain('Past expenses in this group')
  })

  it('preserves repetition as implicit frequency signal', () => {
    const section = buildRecentExpensesSection([
      { title: 'Mercadona', categoryId: 'groceries' },
      { title: 'Mercadona', categoryId: 'groceries' },
      { title: 'Uber', categoryId: 'taxi' },
    ])
    const matches = section.match(/"Mercadona" -> groceries/g)
    expect(matches?.length).toBe(2)
  })
})

describe('buildTranslationDirective', () => {
  it('returns empty string when translation is not requested', () => {
    expect(buildTranslationDirective('es', false)).toBe('')
    expect(buildTranslationDirective('es', undefined)).toBe('')
  })

  it('returns empty string when locale is missing', () => {
    expect(buildTranslationDirective(undefined, true)).toBe('')
    expect(buildTranslationDirective('', true)).toBe('')
  })

  it('returns empty string for unknown locales', () => {
    expect(buildTranslationDirective('xx', true)).toBe('')
  })

  it('names the resolved language and targets title and item titles', () => {
    const directive = buildTranslationDirective('es', true)
    expect(directive).toContain('Español')
    expect(directive).toContain('expense title')
    expect(directive).toContain('every item title')
  })

  it('instructs preserving proper names', () => {
    const directive = buildTranslationDirective('fr-FR', true)
    expect(directive).toContain('Français')
    expect(directive).toContain('proper names')
  })

  it('forbids original text and annotations', () => {
    const directive = buildTranslationDirective('de-DE', true)
    expect(directive).toContain('do not include the original text')
    expect(directive).toContain('Do not change any non-title fields')
  })
})
