import { firstDayOfWeek, isRtlLocale, resolveFormattingLocale } from './i18n'

describe('locale formatting conventions', () => {
  it('resolves language-only bundles to their intended regions', () => {
    expect(resolveFormattingLocale('pt')).toBe('pt-PT')
    expect(resolveFormattingLocale('es')).toBe('es-ES')
    expect(resolveFormattingLocale('en-GZ')).toBe('en-US')
    expect(resolveFormattingLocale('de-DE')).toBe('de-DE')
  })

  it('uses regional first-day-of-week conventions', () => {
    expect(firstDayOfWeek('en-US')).toBe(7)
    expect(firstDayOfWeek('de-DE')).toBe(1)
    expect(firstDayOfWeek('pt')).toBe(7)
  })

  it('falls back to the English-US convention for invalid tags', () => {
    expect(resolveFormattingLocale('')).toBe('en-US')
    expect(firstDayOfWeek('')).toBe(7)
  })

  it('identifies the supported right-to-left language families', () => {
    expect(isRtlLocale('ar-SA')).toBe(true)
    expect(isRtlLocale('he')).toBe(true)
    expect(isRtlLocale('ur-PK')).toBe(true)
    expect(isRtlLocale('en-US')).toBe(false)
  })
})
