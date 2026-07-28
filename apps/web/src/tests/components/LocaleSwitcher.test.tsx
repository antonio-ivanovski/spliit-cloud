import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LocaleSwitcher } from '@/components/locale-switcher'
import { localeFlags, localeRegions } from '@/components/locale-switcher-data'
import { localeLabels, locales } from '@/i18n/request'
import * as i18nSetup from '@/i18n/setup'
import { render, screen, waitFor, within } from '@/test/test-utils'

function mockViewport(desktop: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query === '(min-width: 768px)' ? desktop : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }))
}

function mockBrowserLocales(...locales: string[]) {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(locales)
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(locales[0] ?? '')
}

describe('LocaleSwitcher', () => {
  beforeEach(async () => {
    await i18nSetup.i18n.changeLanguage('en-US')
    vi.spyOn(i18nSetup, 'setUserLocale').mockResolvedValue(undefined)
    mockBrowserLocales('en-US')
  })

  afterEach(async () => {
    await i18nSetup.i18n.changeLanguage('en-US')
    vi.restoreAllMocks()
  })

  it('has exhaustive flags and geographic assignments', () => {
    expect(Object.keys(localeFlags)).toEqual(locales)
    expect(Object.keys(localeRegions)).toEqual(locales)
    for (const locale of locales) {
      expect(localeFlags[locale]).not.toBe('')
      expect(localeRegions[locale]).toBeTruthy()
    }
  })

  it('shows every locale once in prioritized, regional groups', async () => {
    mockViewport(true)
    const { user } = render(<LocaleSwitcher />)

    const trigger = screen.getByRole('button', {
      name: localeLabels['en-US'],
    })
    expect(trigger).toHaveTextContent(localeFlags['en-US'])
    expect(trigger).toHaveTextContent(localeLabels['en-US'])

    await user.click(trigger)

    const listbox = screen.getByRole('listbox')
    expect(within(listbox).getAllByRole('option')).toHaveLength(locales.length)

    const content = listbox.textContent ?? ''
    const headings = [
      'Suggested',
      'Popular',
      'Asia-Pacific',
      'Europe',
      'Middle East & North Africa',
    ]
    for (let index = 1; index < headings.length; index += 1) {
      expect(content.indexOf(headings[index - 1])).toBeLessThan(
        content.indexOf(headings[index]),
      )
    }
    expect(content).not.toContain('Americas')

    expect(
      within(listbox).getByRole('option', { name: /English \(US\)/ }),
    ).toHaveAttribute('aria-current', 'true')
  })

  it('sorts the remaining regional entries by localized language name', async () => {
    mockViewport(true)
    const { user } = render(<LocaleSwitcher />)
    await user.click(
      screen.getByRole('button', { name: localeLabels['en-US'] }),
    )

    const europeHeading = screen.getByText('Europe')
    const europeGroup = europeHeading.parentElement
    expect(europeGroup).not.toBeNull()

    const actual = within(europeGroup as HTMLElement)
      .getAllByRole('option')
      .map((option) =>
        locales.find((locale) =>
          option.textContent?.includes(localeLabels[locale]),
        ),
      )

    const excluded = new Set([
      'en-US',
      'es',
      'fr-FR',
      'de-DE',
      'pt-BR',
      'hi-IN',
    ])
    const displayNames = new Intl.DisplayNames(['en-US'], { type: 'language' })
    const collator = new Intl.Collator('en-US', { sensitivity: 'base' })
    const expected = locales
      .filter(
        (locale) => localeRegions[locale] === 'europe' && !excluded.has(locale),
      )
      .toSorted((a, b) =>
        collator.compare(
          displayNames.of(a) ?? localeLabels[a],
          displayNames.of(b) ?? localeLabels[b],
        ),
      )

    expect(actual).toEqual(expected)
  })

  it('searches native names, localized names, and locale codes', async () => {
    mockViewport(true)
    const { user } = render(<LocaleSwitcher />)
    await user.click(
      screen.getByRole('button', { name: localeLabels['en-US'] }),
    )

    const search = screen.getByPlaceholderText('Search languages...')

    await user.type(search, '日本語')
    expect(
      screen.getByRole('option', { name: /日本語.*Japanese/i }),
    ).toBeVisible()

    await user.clear(search)
    await user.type(search, 'Japanese')
    expect(
      screen.getByRole('option', { name: /日本語.*Japanese/i }),
    ).toBeVisible()

    await user.clear(search)
    await user.type(search, 'pt-BR')
    expect(
      screen.getByRole('option', { name: /Português Brasileiro/i }),
    ).toBeVisible()

    await user.clear(search)
    await user.type(search, 'Klingon')
    expect(screen.getByText('No language found.')).toBeVisible()
  })

  it('uses a flag-only trigger and searchable bottom drawer on mobile', async () => {
    mockViewport(false)
    const { user } = render(<LocaleSwitcher />)

    const trigger = screen.getByRole('button', {
      name: localeLabels['en-US'],
    })
    expect(trigger).toHaveTextContent(localeFlags['en-US'])
    expect(trigger).not.toHaveTextContent(localeLabels['en-US'])
    expect(trigger).toHaveAttribute('title', localeLabels['en-US'])

    await user.click(trigger)

    const drawer = screen.getByRole('dialog', { name: 'Choose language' })
    expect(
      within(drawer).getByPlaceholderText('Search languages...'),
    ).toBeVisible()
    expect(within(drawer).getAllByRole('option')).toHaveLength(locales.length)
    expect(
      within(drawer).getByRole('option', { name: /English \(US\)/ }),
    ).toHaveAttribute('aria-current', 'true')
  })

  it('keeps a non-popular active locale in Suggested', async () => {
    await i18nSetup.i18n.changeLanguage('mk-MK')
    mockBrowserLocales('en-US')
    mockViewport(true)
    const { user } = render(<LocaleSwitcher />)

    await user.click(
      screen.getByRole('button', { name: localeLabels['mk-MK'] }),
    )

    const suggestedHeading = screen.getByText('Suggested')
    const suggestedGroup = suggestedHeading.parentElement
    expect(suggestedGroup).not.toBeNull()
    expect(
      within(suggestedGroup as HTMLElement).getByRole('option', {
        name: /Македонски/,
      }),
    ).toHaveAttribute('aria-current', 'true')
  })

  it('selects a desktop locale', async () => {
    mockViewport(true)
    const { user } = render(<LocaleSwitcher />)

    await user.click(
      screen.getByRole('button', { name: localeLabels['en-US'] }),
    )
    await user.click(screen.getByRole('option', { name: /Français/ }))

    expect(i18nSetup.setUserLocale).toHaveBeenCalledWith('fr-FR')
  })

  it('selects a mobile locale and closes the drawer', async () => {
    mockViewport(false)
    const { user } = render(<LocaleSwitcher />)

    await user.click(
      screen.getByRole('button', { name: localeLabels['en-US'] }),
    )
    const drawer = screen.getByRole('dialog', { name: 'Choose language' })
    await user.click(
      within(drawer).getByRole('option', { name: /日本語.*Japanese/i }),
    )

    expect(i18nSetup.setUserLocale).toHaveBeenCalledWith('ja-JP')
    await waitFor(() => {
      expect(drawer).toHaveAttribute('data-state', 'closed')
    })
  })
})
