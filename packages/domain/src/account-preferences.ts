import { z } from 'zod'

import { supportedCurrencyCodes, type SupportedCurrencyCode } from './currency'
import { locales, type Locale } from './i18n'
import { timeZoneSchema } from './timezones'

export const accountThemeValues = ['light', 'dark', 'system'] as const
export const accountThemeSchema = z.enum(accountThemeValues)
export type AccountTheme = z.infer<typeof accountThemeSchema>

const supportedCurrencyCodeSet = new Set<string>(supportedCurrencyCodes)
const localeSet = new Set<string>(locales)

export const supportedCurrencyCodeSchema = z
  .string()
  .refine(
    (code): code is SupportedCurrencyCode => supportedCurrencyCodeSet.has(code),
    'unsupportedCurrencyCode',
  )

export const accountLocaleSchema = z
  .string()
  .refine(
    (locale): locale is Locale => localeSet.has(locale),
    'unsupportedLocale',
  )

/**
 * Complete persisted account-preference value shape. Nullable scalar fields
 * distinguish an unset preference from an explicit supported value.
 */
export const accountPreferenceSchema = z.object({
  defaultCurrencyCode: supportedCurrencyCodeSchema.nullable(),
  timeZone: timeZoneSchema.nullable(),
  locale: accountLocaleSchema.nullable(),
  theme: accountThemeSchema.nullable(),
})

export type AccountPreference = z.infer<typeof accountPreferenceSchema>
