import { detectLocale, i18n, loadLocale, setUserLocale } from '@/i18n/react'
import { defaultLocale } from '@/i18n/request'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Helpers ────────────────────────────────────────────────────────────

const COOKIE_NAME = 'NEXT_LOCALE'

/**
 * Read a cookie value from jsdom's cookie jar.
 */
function getCookie(name: string): string | undefined {
  return document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`))
    ?.split('=')[1]
}

/**
 * Restore i18n language to default after tests that change it.
 */
async function resetLocale() {
  if (i18n.language !== defaultLocale) {
    await i18n.changeLanguage(defaultLocale)
  }
}

// ── detectLocale ───────────────────────────────────────────────────────

describe('detectLocale', () => {
  beforeEach(() => {
    // Clear any existing cookie
    document.cookie = `${COOKIE_NAME}=;path=/;max-age=0`
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads locale from cookie first', () => {
    document.cookie = `${COOKIE_NAME}=fr-FR;path=/`
    expect(detectLocale()).toBe('fr-FR')
  })

  it('favors cookie over navigator.language', () => {
    // Set both — cookie should win
    document.cookie = `${COOKIE_NAME}=de-DE;path=/`
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US')
    expect(detectLocale()).toBe('de-DE')
  })

  it('falls back to navigator.language when no cookie is set', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('fr-FR')
    expect(detectLocale()).toBe('fr-FR')
  })

  it('falls back to defaultLocale when navigator.language is not supported', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('xx-XX')
    expect(detectLocale()).toBe(defaultLocale)
  })

  it('falls back to defaultLocale when cookie is set to an unsupported locale', () => {
    document.cookie = `${COOKIE_NAME}=xx-XX;path=/`
    expect(detectLocale()).toBe(defaultLocale)
  })
})

// ── loadLocale ─────────────────────────────────────────────────────────

describe('loadLocale', () => {
  afterEach(async () => {
    await resetLocale()
  })

  it('adds resource bundle to i18next for a new locale', async () => {
    const locale = 'fr-FR'

    // Should not have the bundle yet
    expect(i18n.hasResourceBundle(locale, 'translation')).toBe(false)

    await loadLocale(locale)

    expect(i18n.hasResourceBundle(locale, 'translation')).toBe(true)
  })

  it('is idempotent when called twice with the same locale', async () => {
    const locale = 'de-DE'

    // First call
    await loadLocale(locale)
    expect(i18n.hasResourceBundle(locale, 'translation')).toBe(true)

    // Second call — should not throw and bundle stays loaded
    await loadLocale(locale)
    expect(i18n.hasResourceBundle(locale, 'translation')).toBe(true)
  })
})

// ── setUserLocale ──────────────────────────────────────────────────────

describe('setUserLocale', () => {
  beforeEach(() => {
    // Clear any existing cookie
    document.cookie = `${COOKIE_NAME}=;path=/;max-age=0`
  })

  afterEach(async () => {
    await resetLocale()
    vi.restoreAllMocks()
  })

  it('sets cookie with the locale', async () => {
    await setUserLocale('fr-FR')

    expect(getCookie(COOKIE_NAME)).toBe('fr-FR')
  })

  it('loads the locale resources and changes language', async () => {
    await setUserLocale('fr-FR')

    expect(i18n.hasResourceBundle('fr-FR', 'translation')).toBe(true)
    expect(i18n.language).toBe('fr-FR')
  })

  it('can switch between multiple locales', async () => {
    await setUserLocale('fr-FR')
    expect(i18n.language).toBe('fr-FR')

    await setUserLocale('de-DE')
    expect(i18n.language).toBe('de-DE')
    expect(getCookie(COOKIE_NAME)).toBe('de-DE')
  })
})
