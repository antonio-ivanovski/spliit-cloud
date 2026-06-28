import * as i18nReact from '@/i18n/react'
import { localeLabels } from '@/i18n/request'
import { render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LocaleSwitcher } from '@/components/locale-switcher'

describe('LocaleSwitcher', () => {
  beforeEach(() => {
    vi.spyOn(i18nReact, 'setUserLocale').mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders current locale label from localeLabels', () => {
    render(<LocaleSwitcher />)

    // Default locale in test environment is 'en-US'
    const trigger = screen.getByRole('button', { name: localeLabels['en-US'] })
    expect(trigger).toBeInTheDocument()
  })

  it('clicking opens dropdown with all locale options', async () => {
    const user = userEvent.setup()
    render(<LocaleSwitcher />)

    const trigger = screen.getByRole('button', { name: localeLabels['en-US'] })
    await user.click(trigger)

    // All locale labels should be visible in the dropdown (some labels
    // may appear both in the trigger and the menu, so use getAllByText).
    for (const label of Object.values(localeLabels)) {
      const matches = screen.getAllByText(label)
      expect(matches.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('clicking a locale calls setUserLocale with that locale', async () => {
    const user = userEvent.setup()
    render(<LocaleSwitcher />)

    const trigger = screen.getByRole('button', { name: localeLabels['en-US'] })
    await user.click(trigger)

    // Find and click the French locale
    const frenchLabel = localeLabels['fr-FR']
    const frenchItem = screen.getByText(frenchLabel)
    await user.click(frenchItem)

    expect(i18nReact.setUserLocale).toHaveBeenCalledWith('fr-FR')
  })

  it('clicking another locale calls setUserLocale correctly', async () => {
    const user = userEvent.setup()
    render(<LocaleSwitcher />)

    const trigger = screen.getByRole('button', { name: localeLabels['en-US'] })
    await user.click(trigger)

    // Click Japanese locale
    const japaneseLabel = localeLabels['ja-JP']
    await user.click(screen.getByText(japaneseLabel))
    expect(i18nReact.setUserLocale).toHaveBeenCalledWith('ja-JP')
  })

  it('renders all locales as dropdown items', async () => {
    const user = userEvent.setup()
    render(<LocaleSwitcher />)

    const trigger = screen.getByRole('button', { name: localeLabels['en-US'] })
    await user.click(trigger)

    const labels = Object.values(localeLabels)
    expect(labels.length).toBeGreaterThan(20) // sanity check
    for (const label of labels) {
      const matches = screen.getAllByText(label)
      expect(matches.length).toBeGreaterThanOrEqual(1)
    }
  })
})
