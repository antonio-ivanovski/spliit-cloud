import { afterEach, describe, expect, it } from 'vitest'

import {
  cacheAccountPreferences,
  canonicalizeTimeZone,
  clearKeptTimeZoneMismatch,
  getExplicitLocaleCookie,
  getExplicitStoredTheme,
  hasKeptTimeZoneMismatch,
  keepTimeZoneMismatch,
  readCachedAccountPreferences,
  timeZonesMatch,
} from '@/lib/account-preferences'

describe('account preference bootstrap inputs', () => {
  afterEach(() => {
    localStorage.clear()
    document.cookie =
      'SPLIIT_LOCALE=;path=/;expires=Thu, 01 Jan 1970 00:00:00 GMT'
  })

  it('only adopts an explicitly stored supported theme', () => {
    expect(getExplicitStoredTheme()).toBeUndefined()
    localStorage.setItem('theme', 'dark')
    expect(getExplicitStoredTheme()).toBe('dark')
    localStorage.setItem('theme', 'sepia')
    expect(getExplicitStoredTheme()).toBeUndefined()
  })

  it('only adopts a supported explicit locale cookie', () => {
    document.cookie = 'SPLIIT_LOCALE=fr-FR;path=/'
    expect(getExplicitLocaleCookie()).toBe('fr-FR')
    document.cookie = 'SPLIIT_LOCALE=not-a-locale;path=/'
    expect(getExplicitLocaleCookie()).toBeUndefined()
  })

  it('keeps validated snapshots isolated by account id', () => {
    const first = {
      defaultCurrencyCode: 'EUR',
      timeZone: 'Europe/Paris',
      locale: 'fr-FR' as const,
      theme: 'dark' as const,
      notificationsEnabled: true,
      aiFeaturesEnabled: true,
      aiCategoryExtractEnabled: null,
      aiReceiptScanEnabled: null,
      aiVoiceExpenseEnabled: null,
    }
    const second = {
      defaultCurrencyCode: 'USD',
      timeZone: 'America/New_York',
      locale: 'en-US' as const,
      theme: 'light' as const,
      notificationsEnabled: true,
      aiFeaturesEnabled: true,
      aiCategoryExtractEnabled: null,
      aiReceiptScanEnabled: null,
      aiVoiceExpenseEnabled: null,
    }
    cacheAccountPreferences('account-a', first)
    cacheAccountPreferences('account-b', second)

    expect(readCachedAccountPreferences('account-a')).toEqual({
      ...first,
      mascot: 'off',
    })
    expect(readCachedAccountPreferences('account-b')).toEqual({
      ...second,
      mascot: 'off',
    })
    expect(readCachedAccountPreferences('account-c')).toBeNull()
  })

  it('defaults the master AI gate on for older cached snapshots', () => {
    localStorage.setItem(
      'accountPreferences:legacy-ai',
      JSON.stringify({
        defaultCurrencyCode: 'USD',
        timeZone: 'UTC',
        locale: 'en-US',
        theme: 'system',
        aiCategoryExtractEnabled: null,
        aiReceiptScanEnabled: null,
        aiVoiceExpenseEnabled: null,
      }),
    )

    expect(readCachedAccountPreferences('legacy-ai')?.aiFeaturesEnabled).toBe(
      true,
    )
    expect(readCachedAccountPreferences('legacy-ai')?.mascot).toBe('off')
  })

  it('rejects corrupt or unsupported cached snapshots', () => {
    localStorage.setItem('accountPreferences:bad-json', '{')
    localStorage.setItem(
      'accountPreferences:bad-values',
      JSON.stringify({
        defaultCurrencyCode: 'NOPE',
        timeZone: 'Moon/Base',
        locale: 'xx',
        theme: 'sepia',
      }),
    )

    expect(readCachedAccountPreferences('bad-json')).toBeNull()
    expect(readCachedAccountPreferences('bad-values')).toBeNull()
  })

  it('compares canonical timezone identifiers instead of current offsets', () => {
    expect(timeZonesMatch('UTC', 'Etc/UTC')).toBe(true)
    expect(canonicalizeTimeZone('US/Eastern')).toBe(
      canonicalizeTimeZone('America/New_York'),
    )
    expect(timeZonesMatch('Europe/London', 'Africa/Abidjan')).toBe(false)
  })

  it('scopes kept mismatch decisions to the exact account and zone pair', () => {
    keepTimeZoneMismatch('account-a', 'Europe/Paris', 'America/New_York')

    expect(
      hasKeptTimeZoneMismatch('account-a', 'Europe/Paris', 'America/New_York'),
    ).toBe(true)
    expect(
      hasKeptTimeZoneMismatch('account-b', 'Europe/Paris', 'America/New_York'),
    ).toBe(false)
    expect(
      hasKeptTimeZoneMismatch('account-a', 'Europe/Paris', 'Asia/Tokyo'),
    ).toBe(false)

    clearKeptTimeZoneMismatch('account-a')
    expect(
      hasKeptTimeZoneMismatch('account-a', 'Europe/Paris', 'America/New_York'),
    ).toBe(false)
  })
})
