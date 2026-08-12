import { z } from 'zod'

import { supportedCurrencyCodes, type SupportedCurrencyCode } from './currency'
import { locales, type Locale } from './i18n'
import { timeZoneSchema } from './timezones'

export const accountThemeValues = ['light', 'dark', 'system'] as const
export const accountThemeSchema = z.enum(accountThemeValues)
export type AccountTheme = z.infer<typeof accountThemeSchema>

export const accountMascotValues = ['off', 'bill'] as const
export const accountMascotSchema = z.enum(accountMascotValues)
export type AccountMascot = z.infer<typeof accountMascotSchema>

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
 *
 * AI capability toggles (`ai*Enabled`) and the notifications master toggle
 * (`notificationsEnabled`) follow the same nullable convention: a missing or
 * `null` value means "use the default-on behaviour" and is normalized to `true`
 * at the API boundary (`apps/api/.../routers/account`). The `.nullish()`
 * modifier lets older stored shapes that pre-date these fields continue to
 * validate cleanly.
 */
export const accountPreferenceSchema = z.object({
  defaultCurrencyCode: supportedCurrencyCodeSchema.nullable(),
  timeZone: timeZoneSchema.nullable(),
  locale: accountLocaleSchema.nullable(),
  theme: accountThemeSchema.nullable(),
  // Mascots are deliberately opt-in. Older exports do not contain this field;
  // API and client boundaries normalize a missing value to off.
  mascot: accountMascotSchema.optional(),
  notificationsEnabled: z.boolean().nullish(),
  aiFeaturesEnabled: z.boolean().nullish(),
  aiCategoryExtractEnabled: z.boolean().nullish(),
  aiReceiptScanEnabled: z.boolean().nullish(),
  aiVoiceExpenseEnabled: z.boolean().nullish(),
})

export type AccountPreference = z.infer<typeof accountPreferenceSchema>
