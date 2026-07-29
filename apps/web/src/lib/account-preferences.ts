import type { Locale } from '@/i18n/request'
import { locales } from '@/i18n/request'
import { currencyList } from '@spliit/domain/currency'

export type AccountTheme = 'light' | 'dark' | 'system'

export type AccountPreferences = {
  defaultCurrencyCode: string | null
  timeZone: string | null
  locale: Locale | null
  theme: AccountTheme | null
}

export const ACCOUNT_THEME_CHANGED_EVENT = 'spliit:account-theme-changed'
export const ACCOUNT_LOCALE_CHANGED_EVENT = 'spliit:account-locale-changed'
const ACCOUNT_PREFERENCES_CACHE_PREFIX = 'accountPreferences:'
export const TIME_ZONE_MISMATCH_DECISION_PREFIX =
  'accountTimeZoneMismatchDecision:'
const supportedCurrencyCodes = new Set(
  currencyList.map((currency) => currency.code),
)
const supportedThemes = new Set<AccountTheme>(['light', 'dark', 'system'])

function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

function parseAccountPreferences(value: unknown): AccountPreferences | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  const defaultCurrencyCode = candidate.defaultCurrencyCode
  const timeZone = candidate.timeZone
  const locale = candidate.locale
  const theme = candidate.theme

  if (
    defaultCurrencyCode !== null &&
    (typeof defaultCurrencyCode !== 'string' ||
      !supportedCurrencyCodes.has(defaultCurrencyCode))
  )
    return null
  if (timeZone !== null && !isTimeZone(timeZone)) return null
  if (
    locale !== null &&
    (typeof locale !== 'string' ||
      !(locales as readonly string[]).includes(locale))
  )
    return null
  if (
    theme !== null &&
    (typeof theme !== 'string' || !supportedThemes.has(theme as AccountTheme))
  )
    return null
  return {
    defaultCurrencyCode: defaultCurrencyCode as string | null,
    timeZone: timeZone as string | null,
    locale: locale as Locale | null,
    theme: theme as AccountTheme | null,
  }
}

export function readCachedAccountPreferences(
  accountId: string,
): AccountPreferences | null {
  if (!accountId || typeof localStorage === 'undefined') return null
  try {
    return parseAccountPreferences(
      JSON.parse(
        localStorage.getItem(
          `${ACCOUNT_PREFERENCES_CACHE_PREFIX}${accountId}`,
        ) ?? 'null',
      ),
    )
  } catch {
    return null
  }
}

export function cacheAccountPreferences(
  accountId: string,
  preferences: AccountPreferences,
) {
  if (!accountId || typeof localStorage === 'undefined') return
  const validated = parseAccountPreferences(preferences)
  if (!validated) return
  localStorage.setItem(
    `${ACCOUNT_PREFERENCES_CACHE_PREFIX}${accountId}`,
    JSON.stringify(validated),
  )
}

export function detectDeviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

export function canonicalizeTimeZone(timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions()
    .timeZone
}

export function timeZonesMatch(first: string, second: string): boolean {
  try {
    return canonicalizeTimeZone(first) === canonicalizeTimeZone(second)
  } catch {
    return first === second
  }
}

type TimeZoneMismatchDecision = {
  accountTimeZone: string
  browserTimeZone: string
}

export function timeZoneMismatchDecisionKey(accountId: string) {
  return `${TIME_ZONE_MISMATCH_DECISION_PREFIX}${accountId}`
}

export function hasKeptTimeZoneMismatch(
  accountId: string,
  accountTimeZone: string,
  browserTimeZone: string,
): boolean {
  try {
    const raw = localStorage.getItem(timeZoneMismatchDecisionKey(accountId))
    if (!raw) return false
    const decision = JSON.parse(raw) as Partial<TimeZoneMismatchDecision>
    return (
      decision.accountTimeZone === accountTimeZone &&
      decision.browserTimeZone === browserTimeZone
    )
  } catch {
    return false
  }
}

export function keepTimeZoneMismatch(
  accountId: string,
  accountTimeZone: string,
  browserTimeZone: string,
) {
  try {
    localStorage.setItem(
      timeZoneMismatchDecisionKey(accountId),
      JSON.stringify({ accountTimeZone, browserTimeZone }),
    )
  } catch {
    // The in-memory dialog state still resolves for this session.
  }
}

export function clearKeptTimeZoneMismatch(accountId: string) {
  try {
    localStorage.removeItem(timeZoneMismatchDecisionKey(accountId))
  } catch {
    // Storage can be unavailable; matching zones still resolve this session.
  }
}

export function getExplicitStoredTheme(): AccountTheme | undefined {
  const value = localStorage.getItem('theme')
  return value === 'light' || value === 'dark' || value === 'system'
    ? value
    : undefined
}

export function getExplicitLocaleCookie(): Locale | undefined {
  if (typeof document === 'undefined') return undefined
  const value = document.cookie
    .split('; ')
    .find((row) => row.startsWith('SPLIIT_LOCALE='))
    ?.split('=')[1]
  return value && (locales as readonly string[]).includes(value)
    ? (value as Locale)
    : undefined
}

export function getSupportedTimeZones(): string[] {
  try {
    return Array.from(new Set(['UTC', ...Intl.supportedValuesOf('timeZone')]))
  } catch {
    return ['UTC']
  }
}
