import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  account: { id: 'account-a' } as { id: string } | null,
  setTheme: vi.fn(),
  setUserLocale: vi.fn(
    async (
      _locale: string,
      _options?: { notify?: boolean; persist?: boolean },
    ) => undefined,
  ),
  initialize: vi.fn(),
  update: vi.fn(),
  setData: vi.fn(),
  invalidate: vi.fn(),
  queryData: undefined as { preferences: Record<string, unknown> } | undefined,
  locale: 'en-US',
}))

vi.mock('@/lib/use-current-account', () => ({
  useCurrentAccount: () => ({ data: mocks.account }),
}))

vi.mock('@/components/theme-provider', () => ({
  ThemeProvider: ({ children }: React.PropsWithChildren) => children,
  useTheme: () => ({ theme: 'system', setTheme: mocks.setTheme }),
}))

vi.mock('@/i18n/react', () => ({
  useLocale: () => mocks.locale,
}))

vi.mock('@/i18n/setup', () => ({
  detectLocale: () => 'en-US',
  setUserLocale: (
    locale: string,
    options?: { notify?: boolean; persist?: boolean },
  ) => mocks.setUserLocale(locale, options),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      account: {
        getPreferences: {
          setData: mocks.setData,
          invalidate: mocks.invalidate,
        },
      },
    }),
    account: {
      getPreferences: {
        useQuery: () => ({
          data: mocks.queryData,
        }),
      },
      initializePreferences: {
        useMutation: () => ({ mutateAsync: mocks.initialize }),
      },
      updatePreferences: {
        useMutation: () => ({ mutateAsync: mocks.update }),
      },
    },
  },
}))

import {
  AccountPreferencesSync,
  useSyncedAccountPreferences,
} from '@/components/account-preferences-sync'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { ThemeToggle } from '@/components/theme-toggle'
import { localeLabels } from '@/i18n/request'
import {
  cacheAccountPreferences,
  detectDeviceTimeZone,
  readCachedAccountPreferences,
} from '@/lib/account-preferences'

function PreferenceProbe() {
  const preferences = useSyncedAccountPreferences()
  return (
    <div data-testid="account-time-zone">
      {preferences?.timeZone ?? 'unset'}
    </div>
  )
}

describe('AccountPreferencesSync cached account switching', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.account = { id: 'account-a' }
    mocks.setTheme.mockClear()
    mocks.setUserLocale.mockClear()
    mocks.initialize.mockReset()
    mocks.update.mockReset()
    mocks.setData.mockReset()
    mocks.invalidate.mockReset()
    mocks.queryData = undefined
    mocks.locale = 'en-US'
    mocks.setUserLocale.mockImplementation(async (locale: string) => {
      mocks.locale = locale
    })
    cacheAccountPreferences('account-a', {
      defaultCurrencyCode: 'EUR',
      timeZone: 'Europe/Paris',
      locale: 'fr-FR',
      theme: 'dark',
    })
    cacheAccountPreferences('account-b', {
      defaultCurrencyCode: 'USD',
      timeZone: 'America/New_York',
      locale: 'en-US',
      theme: 'light',
    })
  })

  it('applies only the active account cache when switching accounts', () => {
    const view = render(
      <AccountPreferencesSync>
        <div />
      </AccountPreferencesSync>,
    )
    expect(mocks.setTheme).toHaveBeenLastCalledWith('dark', {
      notify: false,
      persist: true,
    })
    expect(mocks.setUserLocale).toHaveBeenLastCalledWith('fr-FR', {
      notify: false,
      persist: true,
    })

    mocks.account = { id: 'account-b' }
    view.rerender(
      <AccountPreferencesSync>
        <div />
      </AccountPreferencesSync>,
    )
    expect(mocks.setTheme).toHaveBeenLastCalledWith('light', {
      notify: false,
      persist: true,
    })
    expect(mocks.setUserLocale).toHaveBeenLastCalledWith('en-US', {
      notify: false,
      persist: true,
    })
  })

  it('does not replace anonymous device-local presentation settings', () => {
    mocks.account = null
    render(
      <AccountPreferencesSync>
        <div />
      </AccountPreferencesSync>,
    )
    expect(mocks.setTheme).not.toHaveBeenCalled()
    expect(mocks.setUserLocale).not.toHaveBeenCalled()
  })

  it('disables signed-in presentation controls until preferences hydrate', () => {
    localStorage.clear()
    mocks.queryData = undefined

    const view = render(
      <AccountPreferencesSync>
        <ThemeToggle />
        <LocaleSwitcher />
      </AccountPreferencesSync>,
    )

    expect(screen.getByRole('button', { name: /change theme/i })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: localeLabels['en-US'] }),
    ).toBeDisabled()

    mocks.queryData = {
      preferences: {
        defaultCurrencyCode: 'USD',
        timeZone: detectDeviceTimeZone(),
        locale: 'en-US',
        theme: 'system',
      },
    }
    view.rerender(
      <AccountPreferencesSync>
        <ThemeToggle />
        <LocaleSwitcher />
      </AccountPreferencesSync>,
    )

    expect(screen.getByRole('button', { name: /change theme/i })).toBeEnabled()
    expect(
      screen.getByRole('button', { name: localeLabels['en-US'] }),
    ).toBeEnabled()
  })

  it('bootstraps unset values from effective device preferences once', async () => {
    localStorage.clear()
    localStorage.setItem('theme', 'dark')
    mocks.queryData = {
      preferences: {
        defaultCurrencyCode: null,
        timeZone: null,
        locale: null,
        theme: null,
      },
    }
    mocks.initialize.mockResolvedValue({
      preferences: {
        defaultCurrencyCode: null,
        timeZone: 'Europe/Skopje',
        locale: 'en-US',
        theme: 'dark',
      },
    })

    const view = render(
      <AccountPreferencesSync>
        <div />
      </AccountPreferencesSync>,
    )
    view.rerender(
      <AccountPreferencesSync>
        <div />
      </AccountPreferencesSync>,
    )

    await waitFor(() => expect(mocks.initialize).toHaveBeenCalledTimes(1))
    expect(mocks.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: 'en-US',
        theme: 'dark',
        timeZone: expect.any(String),
      }),
    )
    await waitFor(() =>
      expect(mocks.setTheme).toHaveBeenCalledWith('dark', {
        notify: false,
        persist: true,
      }),
    )
  })

  it('persists one navbar language event without an invalidate loop', async () => {
    mocks.queryData = {
      preferences: {
        defaultCurrencyCode: null,
        timeZone: 'Europe/Skopje',
        locale: 'en-US',
        theme: 'system',
      },
    }
    mocks.initialize.mockResolvedValue(mocks.queryData)
    mocks.update.mockResolvedValue({
      preferences: {
        ...mocks.queryData.preferences,
        locale: 'fr-FR',
      },
    })
    render(
      <AccountPreferencesSync>
        <div />
      </AccountPreferencesSync>,
    )
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalledTimes(1))

    act(() => {
      window.dispatchEvent(
        new CustomEvent('spliit:account-locale-changed', {
          detail: 'fr-FR',
        }),
      )
    })

    await waitFor(() => {
      expect(mocks.update).toHaveBeenCalledTimes(1)
    })
    expect(mocks.update).toHaveBeenCalledWith({ locale: 'fr-FR' })
    expect(mocks.setData).toHaveBeenCalled()
  })

  it('persists one navbar theme event without a feedback loop', async () => {
    mocks.queryData = {
      preferences: {
        defaultCurrencyCode: 'USD',
        timeZone: 'Europe/Skopje',
        locale: 'en-US',
        theme: 'system',
      },
    }
    mocks.initialize.mockResolvedValue(mocks.queryData)
    mocks.update.mockResolvedValue({
      preferences: {
        ...mocks.queryData.preferences,
        theme: 'dark',
      },
    })
    render(
      <AccountPreferencesSync>
        <div />
      </AccountPreferencesSync>,
    )
    expect(mocks.initialize).not.toHaveBeenCalled()

    act(() => {
      window.dispatchEvent(
        new CustomEvent('spliit:account-theme-changed', {
          detail: 'dark',
        }),
      )
    })

    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1))
    expect(mocks.update).toHaveBeenCalledWith({ theme: 'dark' })
  })

  it('serializes rapid navbar preference writes in interaction order', async () => {
    mocks.queryData = {
      preferences: {
        defaultCurrencyCode: 'USD',
        timeZone: 'Europe/Skopje',
        locale: 'en-US',
        theme: 'system',
      },
    }
    mocks.initialize.mockResolvedValue(mocks.queryData)
    let releaseFirst: (() => void) | undefined
    mocks.update
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseFirst = resolve
          }),
      )
      .mockResolvedValueOnce(undefined)
    render(
      <AccountPreferencesSync>
        <div />
      </AccountPreferencesSync>,
    )
    expect(mocks.initialize).not.toHaveBeenCalled()

    act(() => {
      window.dispatchEvent(
        new CustomEvent('spliit:account-theme-changed', { detail: 'dark' }),
      )
      window.dispatchEvent(
        new CustomEvent('spliit:account-locale-changed', {
          detail: 'fr-FR',
        }),
      )
    })

    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1))
    expect(mocks.update).toHaveBeenNthCalledWith(1, { theme: 'dark' })

    releaseFirst?.()

    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2))
    expect(mocks.update).toHaveBeenNthCalledWith(2, { locale: 'fr-FR' })
  })

  it('does not expose or cache device overlays while initialization is pending', async () => {
    localStorage.removeItem('accountPreferences:account-a')
    mocks.queryData = {
      preferences: {
        defaultCurrencyCode: null,
        timeZone: null,
        locale: null,
        theme: null,
      },
    }
    mocks.initialize.mockImplementation(() => new Promise(() => undefined))

    const { getByTestId } = render(
      <AccountPreferencesSync>
        <PreferenceProbe />
      </AccountPreferencesSync>,
    )

    await waitFor(() => expect(mocks.initialize).toHaveBeenCalledTimes(1))
    expect(getByTestId('account-time-zone')).toHaveTextContent('unset')
    expect(readCachedAccountPreferences('account-a')?.timeZone).toBeNull()
  })

  it('retries a failed initialization instead of marking bootstrap complete', async () => {
    vi.useFakeTimers()
    localStorage.removeItem('accountPreferences:account-a')
    mocks.queryData = {
      preferences: {
        defaultCurrencyCode: null,
        timeZone: null,
        locale: null,
        theme: null,
      },
    }
    mocks.initialize
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        preferences: {
          defaultCurrencyCode: 'USD',
          timeZone: 'Europe/Skopje',
          locale: 'en-US',
          theme: 'system',
        },
      })

    render(
      <AccountPreferencesSync>
        <PreferenceProbe />
      </AccountPreferencesSync>,
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(mocks.initialize).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(mocks.initialize).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('rolls an optimistic preference back to the last confirmed response', async () => {
    mocks.queryData = {
      preferences: {
        defaultCurrencyCode: 'USD',
        timeZone: 'Europe/Skopje',
        locale: 'en-US',
        theme: 'system',
      },
    }
    mocks.update.mockRejectedValue(new Error('offline'))

    render(
      <AccountPreferencesSync>
        <div />
      </AccountPreferencesSync>,
    )
    act(() => {
      window.dispatchEvent(
        new CustomEvent('spliit:account-theme-changed', { detail: 'dark' }),
      )
    })

    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(mocks.setData).toHaveBeenLastCalledWith(undefined, {
        preferences: mocks.queryData?.preferences,
      }),
    )
    expect(readCachedAccountPreferences('account-a')?.theme).toBe('system')
  })
})
