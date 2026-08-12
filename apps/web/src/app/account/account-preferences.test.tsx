import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as I18nSetupModule from '@/i18n/setup'
import { render, screen } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  patchPreferences: vi.fn(async () => undefined),
  setTheme: vi.fn(),
  setUserLocale: vi.fn(async () => undefined),
  preferences: {
    defaultCurrencyCode: 'USD',
    timeZone: 'Europe/Skopje',
    locale: 'en-US',
    theme: 'system',
    mascot: 'off',
  },
}))

vi.mock('@/components/account-preferences-sync', () => ({
  useSyncedAccountPreferences: () => mocks.preferences,
  useAccountPreferenceUpdater: () => ({
    ready: true,
    isUpdating: false,
    patchPreferences: mocks.patchPreferences,
  }),
}))

vi.mock('@/components/currency-selector', () => ({
  CurrencySelector: ({
    onValueChange,
    id,
  }: {
    onValueChange: (currencyCode: string) => void
    id?: string
  }) => (
    <button
      type="button"
      id={id}
      aria-label="Default currency"
      onClick={() => onValueChange('EUR')}
    >
      US Dollar (USD)
    </button>
  ),
}))

vi.mock('@/components/time-zone-field', () => ({
  TimeZoneField: ({
    onChange,
    id,
  }: {
    onChange: (timeZone: string) => void
    id?: string
  }) => (
    <button
      type="button"
      id={id}
      aria-label="Account timezone"
      onClick={() => onChange('Europe/Paris')}
    >
      Europe/Skopje
    </button>
  ),
}))

vi.mock('@/components/locale-switcher', () => ({
  LocaleSelector: ({
    onValueChange,
    id,
  }: {
    onValueChange: (locale: string) => void
    id?: string
  }) => (
    <button
      type="button"
      id={id}
      aria-label="Language"
      onClick={() => onValueChange('fr-FR')}
    >
      English (US)
    </button>
  ),
}))

vi.mock('@/components/theme-provider', () => ({
  ThemeProvider: ({ children }: React.PropsWithChildren) => children,
  useTheme: () => ({ setTheme: mocks.setTheme }),
}))

vi.mock(
  '@/i18n/setup',
  async (importOriginal: () => Promise<typeof I18nSetupModule>) => {
    const actual = await importOriginal()
    return { ...actual, setUserLocale: mocks.setUserLocale }
  },
)

vi.mock('@/lib/currency', () => ({
  useCurrencies: () => [
    { code: 'USD', symbol: '$', name: 'US Dollar' },
    { code: 'EUR', symbol: '€', name: 'Euro' },
  ],
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    account: {
      getPreferences: {
        useQuery: () => ({ data: { preferences: mocks.preferences } }),
      },
    },
    features: {
      get: {
        useQuery: () => ({ data: undefined }),
      },
    },
  },
}))

import { AccountPreferences } from './account-preferences'

describe('AccountPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists selector changes immediately without a save action', async () => {
    const { user } = render(<AccountPreferences />)

    await user.click(screen.getByRole('button', { name: 'Default currency' }))
    await user.click(screen.getByRole('button', { name: 'Account timezone' }))
    await user.click(screen.getByRole('button', { name: 'Language' }))

    expect(mocks.patchPreferences).toHaveBeenCalledWith({
      defaultCurrencyCode: 'EUR',
    })
    expect(mocks.patchPreferences).toHaveBeenCalledWith({
      timeZone: 'Europe/Paris',
    })
    expect(mocks.setUserLocale).toHaveBeenCalledWith('fr-FR', {
      notify: false,
      persist: false,
    })
    expect(mocks.patchPreferences).toHaveBeenCalledWith({ locale: 'fr-FR' })
    expect(
      screen.queryByRole('button', { name: /save preferences/i }),
    ).toBeNull()
  })

  it('applies theme changes immediately', async () => {
    const { user } = render(<AccountPreferences />)
    const themeTrigger = screen.getByText('System default').closest('button')
    expect(themeTrigger).not.toBeNull()

    await user.click(themeTrigger!)
    await user.click(screen.getByRole('option', { name: 'Dark' }))

    expect(mocks.setTheme).toHaveBeenCalledWith('dark', {
      notify: false,
      persist: false,
    })
    expect(mocks.patchPreferences).toHaveBeenCalledWith({ theme: 'dark' })
  })

  it('enables Bill as an account-synced mascot preference', async () => {
    const { user } = render(<AccountPreferences />)

    await user.click(screen.getByText('Off').closest('button')!)
    await user.click(screen.getByRole('option', { name: 'Bill the receipt' }))

    expect(mocks.patchPreferences).toHaveBeenCalledWith({ mascot: 'bill' })
  })

  it('associates every row label with its control via htmlFor', () => {
    render(<AccountPreferences />)

    for (const labelText of [
      'Default currency',
      'Account timezone',
      'Language',
      'Theme',
      'Mascot',
    ]) {
      const label = screen.getByText(labelText).closest('label')
      expect(label, `${labelText} should be a <label>`).not.toBeNull()
      const targetId = label!.htmlFor
      expect(targetId, `${labelText} should target an id`).not.toBe('')
      const target = document.getElementById(targetId)
      expect(
        target,
        `${labelText} label should point at an existing control`,
      ).not.toBeNull()
    }
  })

  it('explains how the account timezone is used', () => {
    render(<AccountPreferences />)

    expect(
      screen.getByText(
        'Sets the default timezone for new expense times and recurring schedules, and is used to display timestamps and relative dates.',
      ),
    ).toBeVisible()
  })
})
