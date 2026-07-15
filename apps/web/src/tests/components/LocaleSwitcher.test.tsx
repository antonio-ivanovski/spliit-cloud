import { LocaleSwitcher, localeFlags } from '@/components/locale-switcher'
import { localeLabels, locales } from '@/i18n/request'
import * as i18nSetup from '@/i18n/setup'
import { render, screen, waitFor, within } from '@/test/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('LocaleSwitcher', () => {
  beforeEach(() => {
    vi.spyOn(i18nSetup, 'setUserLocale').mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('has an exhaustive, non-empty flag mapping', () => {
    expect(Object.keys(localeFlags)).toEqual(locales)
    for (const locale of locales) {
      expect(localeFlags[locale]).not.toBe('')
    }
  })

  it('shows the flag and native label in the desktop trigger and dropdown', async () => {
    mockViewport(true)
    const { user } = render(<LocaleSwitcher />)

    const trigger = screen.getByRole('button', {
      name: localeLabels['en-US'],
    })
    expect(trigger).toHaveTextContent(localeFlags['en-US'])
    expect(trigger).toHaveTextContent(localeLabels['en-US'])

    await user.click(trigger)

    for (const locale of locales) {
      const option = screen.getByRole('menuitem', {
        name: localeLabels[locale],
      })
      expect(option).toHaveTextContent(localeFlags[locale])
    }
    expect(
      screen.getByRole('menuitem', { name: localeLabels['en-US'] }),
    ).toHaveAttribute('aria-current', 'true')
  })

  it('uses a flag-only trigger and bottom drawer on mobile', async () => {
    mockViewport(false)
    const { user } = render(<LocaleSwitcher />)

    const trigger = screen.getByRole('button', {
      name: localeLabels['en-US'],
    })
    expect(trigger).toHaveTextContent(localeFlags['en-US'])
    expect(trigger).not.toHaveTextContent(localeLabels['en-US'])
    expect(trigger).toHaveAttribute('title', localeLabels['en-US'])

    await user.click(trigger)

    const drawer = screen.getByRole('dialog', {
      name: localeLabels['en-US'],
    })
    expect(drawer).toBeInTheDocument()
    for (const locale of locales) {
      const option = within(drawer).getByRole('button', {
        name: localeLabels[locale],
      })
      expect(option).toHaveTextContent(localeFlags[locale])
    }
    expect(
      within(drawer).getByRole('button', { name: localeLabels['en-US'] }),
    ).toHaveAttribute('aria-current', 'true')
  })

  it('selects a desktop locale', async () => {
    mockViewport(true)
    const { user } = render(<LocaleSwitcher />)

    await user.click(
      screen.getByRole('button', { name: localeLabels['en-US'] }),
    )
    await user.click(
      screen.getByRole('menuitem', { name: localeLabels['fr-FR'] }),
    )

    expect(i18nSetup.setUserLocale).toHaveBeenCalledWith('fr-FR')
  })

  it('selects a mobile locale and closes the drawer', async () => {
    mockViewport(false)
    const { user } = render(<LocaleSwitcher />)

    await user.click(
      screen.getByRole('button', { name: localeLabels['en-US'] }),
    )
    const drawer = screen.getByRole('dialog', {
      name: localeLabels['en-US'],
    })
    await user.click(
      within(drawer).getByRole('button', { name: localeLabels['ja-JP'] }),
    )

    expect(i18nSetup.setUserLocale).toHaveBeenCalledWith('ja-JP')
    await waitFor(() => {
      expect(drawer).toHaveAttribute('data-state', 'closed')
    })
  })
})
