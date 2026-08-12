import {
  accountLocaleSchema,
  accountMascotSchema,
  accountPreferenceSchema,
  accountThemeSchema,
  supportedCurrencyCodeSchema,
} from './account-preferences'

describe('account preference schemas', () => {
  it('accepts supported themes, locales, and ISO currencies', () => {
    expect(accountThemeSchema.parse('system')).toBe('system')
    expect(accountMascotSchema.parse('bill')).toBe('bill')
    expect(accountLocaleSchema.parse('mk-MK')).toBe('mk-MK')
    expect(supportedCurrencyCodeSchema.parse('EUR')).toBe('EUR')
  })

  it('rejects unknown themes, locales, and custom currencies', () => {
    expect(accountThemeSchema.safeParse('sepia').success).toBe(false)
    expect(accountMascotSchema.safeParse('ghost').success).toBe(false)
    expect(accountLocaleSchema.safeParse('xx-XX').success).toBe(false)
    expect(supportedCurrencyCodeSchema.safeParse('CUSTOM').success).toBe(false)
  })

  it('allows unset scalar preferences', () => {
    expect(
      accountPreferenceSchema.parse({
        defaultCurrencyCode: null,
        timeZone: null,
        locale: null,
        theme: null,
      }),
    ).toEqual({
      defaultCurrencyCode: null,
      timeZone: null,
      locale: null,
      theme: null,
    })
  })
})
