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
  }: {
    onValueChange: (currencyCode: string) => void
  }) => (
    <button
      type="button"
      aria-label="Default currency"
      onClick={() => onValueChange('EUR')}
    >
      US Dollar (USD)
    </button>
  ),
}))

vi.mock('@/components/time-zone-field', () => ({
  TimeZoneField: ({ onChange }: { onChange: (timeZone: string) => void }) => (
    <button
      type="button"
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
  }: {
    onValueChange: (locale: string) => void
  }) => (
    <button
      type="button"
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
})
