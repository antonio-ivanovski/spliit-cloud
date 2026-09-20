import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { act, render, screen, waitFor } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  useCurrentAccount: vi.fn(),
  usePushNotifications: vi.fn(),
  usePreferencesQuery: vi.fn(),
  enable: vi.fn(),
  savePreferences: vi.fn(),
  invalidatePreferences: vi.fn(),
  emailDeliveryEnabled: true as boolean | null,
  navigate: vi.fn(async ({ to, hash }: { to: string; hash?: string }) => {
    window.history.pushState({}, '', `${to}${hash ? `#${hash}` : ''}`)
  }),
}))

vi.mock('@/lib/use-current-account', () => ({
  useCurrentAccount: mocks.useCurrentAccount,
}))

vi.mock('@/lib/use-push-notifications', () => ({
  usePushNotifications: mocks.usePushNotifications,
}))

vi.mock('@/lib/deployment-config', () => ({
  useDeploymentConfig: () => ({
    emailDeliveryEnabled: mocks.emailDeliveryEnabled,
  }),
}))

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual('@tanstack/react-router')
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  }
})

vi.mock('@/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      notifications: {
        preferences: { get: { invalidate: mocks.invalidatePreferences } },
      },
    }),
    notifications: {
      preferences: {
        get: { useQuery: mocks.usePreferencesQuery },
        save: {
          useMutation: () => ({
            mutateAsync: mocks.savePreferences,
            isPending: false,
          }),
        },
      },
    },
  },
}))

import {
  PUSH_ONBOARDING_ACTIVE_KEY,
  PUSH_ONBOARDING_COMPLETE_PREFIX,
  PushNotificationOnboarding,
} from './push-notification-onboarding'

describe('PushNotificationOnboarding', () => {
  afterEach(() => vi.unstubAllGlobals())
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState({}, '', '/')
    vi.clearAllMocks()
    mocks.emailDeliveryEnabled = true
    mocks.useCurrentAccount.mockReturnValue({
      data: { id: 'account-1', name: 'Ada', email: 'ada@example.com' },
      isPending: false,
    })
    mocks.usePushNotifications.mockReturnValue({
      supported: true,
      configured: true,
      iosHomeScreenRequired: false,
      permission: 'default',
      enabled: false,
      enable: mocks.enable,
    })
    mocks.enable.mockResolvedValue(undefined)
    mocks.savePreferences.mockResolvedValue(undefined)
    mocks.invalidatePreferences.mockResolvedValue(undefined)
    mocks.usePreferencesQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        hasExplicitPreferences: false,
        categories: [
          { category: 'GROUP_INVITE_RECEIVED', effectiveChannels: ['EMAIL'] },
          { category: 'FRIEND_ADDED', effectiveChannels: ['EMAIL'] },
          { category: 'EXPENSE_CREATED', effectiveChannels: ['EMAIL'] },
          { category: 'EXPENSE_CHANGED', effectiveChannels: ['EMAIL'] },
        ],
      },
    })
  })

  it('presents once and records the email choice per account', async () => {
    const user = userEvent.setup()
    render(<PushNotificationOnboarding />)

    expect(
      await screen.findByTestId('push-notification-onboarding'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /use email/i }))

    await waitFor(() => {
      expect(mocks.savePreferences).toHaveBeenCalledWith({
        preferences: [
          { category: 'GROUP_INVITE_RECEIVED', channels: ['EMAIL'] },
          { category: 'FRIEND_ADDED', channels: ['EMAIL'] },
          { category: 'EXPENSE_CREATED', channels: ['EMAIL'] },
          { category: 'RECURRING_EXPENSE_CREATED', channels: ['EMAIL'] },
          { category: 'EXPENSE_CHANGED', channels: ['EMAIL'] },
          { category: 'EXPENSE_COMMENT', channels: ['EMAIL'] },
          { category: 'BUDGET_ALERT', channels: ['EMAIL'] },
        ],
      })
      expect(
        localStorage.getItem(`${PUSH_ONBOARDING_COMPLETE_PREFIX}account-1`),
      ).toBe('true')
    })
    expect(screen.queryByTestId('push-notification-onboarding')).toBeNull()
  })

  it('keeps long onboarding content inside the responsive scroll body', async () => {
    render(<PushNotificationOnboarding />)

    const dialog = await screen.findByTestId('push-notification-onboarding')
    expect(dialog).toHaveClass('min-w-0')
    expect(dialog.querySelector('.min-w-0')).not.toBeNull()
    expect(
      screen.getByRole('button', { name: /enable push notifications/i }),
    ).toHaveClass('max-w-full', 'whitespace-normal')
  })

  it('releases install-promotion coordination when eligibility disappears', async () => {
    const { rerender } = render(<PushNotificationOnboarding />)

    await waitFor(() => {
      expect(localStorage.getItem(PUSH_ONBOARDING_ACTIVE_KEY)).not.toBeNull()
    })

    mocks.useCurrentAccount.mockReturnValue({
      data: null,
      isPending: false,
    })
    rerender(<PushNotificationOnboarding />)

    await waitFor(() => {
      expect(localStorage.getItem(PUSH_ONBOARDING_ACTIVE_KEY)).toBeNull()
    })
    expect(
      localStorage.getItem(`${PUSH_ONBOARDING_COMPLETE_PREFIX}account-1`),
    ).toBeNull()
  })

  it('does not compete for a live cross-tab lock and acquires it after release', async () => {
    localStorage.setItem(
      PUSH_ONBOARDING_ACTIVE_KEY,
      JSON.stringify({
        token: 'another-tab',
        expiresAt: Date.now() + 10_000,
      }),
    )
    render(<PushNotificationOnboarding />)

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 800))
    })
    expect(screen.queryByTestId('push-notification-onboarding')).toBeNull()

    const oldValue = localStorage.getItem(PUSH_ONBOARDING_ACTIVE_KEY)
    localStorage.removeItem(PUSH_ONBOARDING_ACTIVE_KEY)
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: PUSH_ONBOARDING_ACTIVE_KEY,
          oldValue,
          newValue: null,
        }),
      )
    })

    expect(
      await screen.findByTestId('push-notification-onboarding'),
    ).toBeInTheDocument()
  })

  it('retries after an abandoned cross-tab lock expires', async () => {
    localStorage.setItem(
      PUSH_ONBOARDING_ACTIVE_KEY,
      JSON.stringify({
        token: 'crashed-tab',
        expiresAt: Date.now() + 100,
      }),
    )
    render(<PushNotificationOnboarding />)

    expect(
      await screen.findByTestId('push-notification-onboarding'),
    ).toBeInTheDocument()
  })

  it('re-checks ownership before opening after a competing write', async () => {
    render(<PushNotificationOnboarding />)
    await waitFor(() => {
      expect(localStorage.getItem(PUSH_ONBOARDING_ACTIVE_KEY)).not.toBeNull()
    })

    localStorage.setItem(
      PUSH_ONBOARDING_ACTIVE_KEY,
      JSON.stringify({
        token: 'winning-tab',
        expiresAt: Date.now() + 10_000,
      }),
    )

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 800))
    })
    expect(screen.queryByTestId('push-notification-onboarding')).toBeNull()
  })

  it('closes safely when another tab completes onboarding', async () => {
    render(<PushNotificationOnboarding />)
    await screen.findByTestId('push-notification-onboarding')

    const key = `${PUSH_ONBOARDING_COMPLETE_PREFIX}account-1`
    localStorage.setItem(key, 'true')
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key,
          oldValue: null,
          newValue: 'true',
        }),
      )
    })

    await waitFor(() => {
      expect(screen.queryByTestId('push-notification-onboarding')).toBeNull()
    })
    expect(localStorage.getItem(PUSH_ONBOARDING_ACTIVE_KEY)).toBeNull()
    expect(mocks.savePreferences).not.toHaveBeenCalled()
  })

  it('enables push only after the explicit button gesture', async () => {
    const user = userEvent.setup()
    render(<PushNotificationOnboarding />)
    await screen.findByTestId('push-notification-onboarding')

    expect(mocks.enable).not.toHaveBeenCalled()
    await user.click(
      screen.getByRole('button', { name: /enable push notifications/i }),
    )
    expect(mocks.enable).toHaveBeenCalledTimes(1)
  })

  it('hides throughout setup, retains ownership, and completes only after saving', async () => {
    const push = Promise.withResolvers<void>()
    const save = Promise.withResolvers<void>()
    mocks.enable.mockReturnValue(push.promise)
    mocks.savePreferences.mockReturnValue(save.promise)
    const user = userEvent.setup()
    const { rerender } = render(<PushNotificationOnboarding />)
    await screen.findByTestId('push-notification-onboarding')
    const owner = JSON.parse(
      localStorage.getItem(PUSH_ONBOARDING_ACTIVE_KEY)!,
    ).token
    await user.click(
      screen.getByRole('button', { name: /enable push notifications/i }),
    )
    expect(screen.queryByTestId('push-notification-onboarding')).toBeNull()
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 800))
    })
    expect(screen.queryByTestId('push-notification-onboarding')).toBeNull()
    expect(
      JSON.parse(localStorage.getItem(PUSH_ONBOARDING_ACTIVE_KEY)!).token,
    ).toBe(owner)
    expect(
      localStorage.getItem(`${PUSH_ONBOARDING_COMPLETE_PREFIX}account-1`),
    ).toBeNull()
    await act(async () => push.resolve())
    expect(mocks.savePreferences).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('push-notification-onboarding')).toBeNull()
    expect(
      localStorage.getItem(`${PUSH_ONBOARDING_COMPLETE_PREFIX}account-1`),
    ).toBeNull()
    await act(async () => save.resolve())
    rerender(<PushNotificationOnboarding />)
    expect(screen.queryByTestId('push-notification-onboarding')).toBeNull()
    expect(
      localStorage.getItem(`${PUSH_ONBOARDING_COMPLETE_PREFIX}account-1`),
    ).toBe('true')
    expect(localStorage.getItem(PUSH_ONBOARDING_ACTIVE_KEY)).toBeNull()
  })

  it.each(['push', 'denied', 'preferences'])(
    'reopens after a deferred %s failure',
    async (failure) => {
      const pending = Promise.withResolvers<void>()
      if (failure === 'preferences')
        mocks.savePreferences.mockReturnValue(pending.promise)
      else mocks.enable.mockReturnValue(pending.promise)
      const user = userEvent.setup()
      const { rerender } = render(<PushNotificationOnboarding />)
      await screen.findByTestId('push-notification-onboarding')
      await user.click(
        screen.getByRole('button', { name: /enable push notifications/i }),
      )
      expect(screen.queryByTestId('push-notification-onboarding')).toBeNull()
      if (failure === 'denied') {
        vi.stubGlobal('Notification', { permission: 'denied' })
        mocks.usePushNotifications.mockReturnValue({
          ...mocks.usePushNotifications(),
          permission: 'denied',
        })
        rerender(<PushNotificationOnboarding />)
        expect(localStorage.getItem(PUSH_ONBOARDING_ACTIVE_KEY)).not.toBeNull()
      }
      await act(async () => pending.reject(new Error('setup failed')))
      expect(
        await screen.findByTestId('push-notification-onboarding'),
      ).toBeInTheDocument()
      if (failure === 'preferences')
        expect(screen.getByRole('alert')).toHaveTextContent(
          /could not save notification preferences/i,
        )
      else {
        expect(screen.getByRole('button', { name: /done/i })).toBeEnabled()
        expect(
          screen.getByText(
            failure === 'denied'
              ? 'Push notifications are blocked'
              : 'Push could not be enabled',
          ),
        ).toBeInTheDocument()
      }
      expect(
        localStorage.getItem(`${PUSH_ONBOARDING_COMPLETE_PREFIX}account-1`),
      ).toBeNull()
    },
  )

  it.each([
    ['account', 'success'],
    ['account', 'failure'],
    ['unmount', 'success'],
    ['unmount', 'failure'],
  ])('ignores pending %s results on %s', async (change, outcome) => {
    const pending = Promise.withResolvers<void>()
    mocks.enable.mockReturnValue(pending.promise)
    const user = userEvent.setup()
    const { rerender, unmount } = render(<PushNotificationOnboarding />)
    await screen.findByTestId('push-notification-onboarding')
    await user.click(
      screen.getByRole('button', { name: /enable push notifications/i }),
    )
    if (change === 'unmount') unmount()
    else {
      mocks.useCurrentAccount.mockReturnValue({
        data: undefined,
        isPending: false,
      })
      rerender(<PushNotificationOnboarding />)
    }
    await act(async () => {
      if (outcome === 'success') pending.resolve()
      else pending.reject(new Error('late failure'))
    })
    expect(mocks.savePreferences).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(
      localStorage.getItem(`${PUSH_ONBOARDING_COMPLETE_PREFIX}account-1`),
    ).toBeNull()
    expect(screen.queryByTestId('push-notification-onboarding')).toBeNull()
  })

  it('applies the optimized channels after the first push opt-in', async () => {
    const user = userEvent.setup()
    render(<PushNotificationOnboarding />)
    await screen.findByTestId('push-notification-onboarding')

    await user.click(
      screen.getByRole('button', { name: /enable push notifications/i }),
    )

    await waitFor(() => {
      expect(mocks.savePreferences).toHaveBeenCalledWith({
        preferences: [
          { category: 'GROUP_INVITE_RECEIVED', channels: ['EMAIL', 'PUSH'] },
          { category: 'FRIEND_ADDED', channels: ['EMAIL', 'PUSH'] },
          { category: 'EXPENSE_CREATED', channels: ['PUSH'] },
          { category: 'RECURRING_EXPENSE_CREATED', channels: ['PUSH'] },
          { category: 'EXPENSE_CHANGED', channels: ['PUSH'] },
          { category: 'EXPENSE_COMMENT', channels: ['PUSH'] },
          { category: 'BUDGET_ALERT', channels: ['EMAIL', 'PUSH'] },
        ],
      })
    })
  })

  it('offers device-only setup without changing Push preferences', async () => {
    mocks.usePreferencesQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        hasExplicitPreferences: true,
        categories: [
          { category: 'EXPENSE_CREATED', effectiveChannels: ['PUSH'] },
        ],
      },
    })
    const user = userEvent.setup()
    render(<PushNotificationOnboarding />)
    await screen.findByTestId('push-notification-onboarding')

    await user.click(
      screen.getByRole('button', { name: /enable push notifications/i }),
    )

    await waitFor(() => expect(mocks.enable).toHaveBeenCalledTimes(1))
    expect(mocks.savePreferences).not.toHaveBeenCalled()
  })

  it('does not prompt again when all active notifications are turned off', async () => {
    mocks.usePreferencesQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        hasExplicitPreferences: true,
        categories: [
          { category: 'GROUP_INVITE_RECEIVED', effectiveChannels: [] },
          { category: 'FRIEND_ADDED', effectiveChannels: [] },
          { category: 'EXPENSE_CREATED', effectiveChannels: [] },
          { category: 'EXPENSE_CHANGED', effectiveChannels: [] },
        ],
      },
    })
    render(<PushNotificationOnboarding />)

    await new Promise((resolve) => window.setTimeout(resolve, 800))
    expect(screen.queryByTestId('push-notification-onboarding')).toBeNull()
  })

  it('opens notification settings after enabling an Email-only account', async () => {
    mocks.usePreferencesQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        hasExplicitPreferences: true,
        categories: [
          { category: 'EXPENSE_CREATED', effectiveChannels: ['EMAIL'] },
        ],
      },
    })
    const user = userEvent.setup()
    render(<PushNotificationOnboarding />)
    await screen.findByTestId('push-notification-onboarding')

    await user.click(
      screen.getByRole('button', { name: /enable push notifications/i }),
    )

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/account/settings',
        hash: 'notifications',
      })
    })
    expect(mocks.savePreferences).not.toHaveBeenCalled()
  })

  it('explains email usage after push registration fails', async () => {
    mocks.usePushNotifications.mockReturnValue({
      supported: true,
      configured: true,
      iosHomeScreenRequired: false,
      permission: 'default',
      enabled: false,
      enable: mocks.enable.mockRejectedValue(new Error('denied')),
    })
    const user = userEvent.setup()
    render(<PushNotificationOnboarding />)
    await screen.findByTestId('push-notification-onboarding')
    await user.click(
      screen.getByRole('button', { name: /enable push notifications/i }),
    )

    expect(
      await screen.findByText(/only notifications configured for email/i),
    ).toBeInTheDocument()
    expect(mocks.savePreferences).not.toHaveBeenCalled()
    expect(localStorage.getItem(PUSH_ONBOARDING_ACTIVE_KEY)).not.toBeNull()
    expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /done/i }))
    expect(localStorage.getItem(PUSH_ONBOARDING_ACTIVE_KEY)).toBeNull()
  })

  it('offers dismiss instead of email fallback when delivery is off', async () => {
    mocks.emailDeliveryEnabled = false
    const user = userEvent.setup()
    render(<PushNotificationOnboarding />)
    await screen.findByTestId('push-notification-onboarding')

    expect(
      screen.getByText(/email delivery is turned off on this instance/i),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /use email/i }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /don't ask again/i }))

    await waitFor(() => {
      expect(screen.queryByTestId('push-notification-onboarding')).toBeNull()
    })
    expect(mocks.savePreferences).not.toHaveBeenCalled()
    expect(
      localStorage.getItem(`${PUSH_ONBOARDING_COMPLETE_PREFIX}account-1`),
    ).toBe('true')
  })

  it('warns email-only accounts about delivery instead of email coverage', async () => {
    mocks.emailDeliveryEnabled = false
    mocks.usePreferencesQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        hasExplicitPreferences: true,
        categories: [
          { category: 'EXPENSE_CREATED', effectiveChannels: ['EMAIL'] },
        ],
      },
    })
    render(<PushNotificationOnboarding />)
    await screen.findByTestId('push-notification-onboarding')

    expect(
      screen.getByText(/email delivery is turned off on this instance/i),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/only notifications configured for email/i),
    ).not.toBeInTheDocument()
  })

  it('explains delivery is off after push registration fails without SMTP', async () => {
    mocks.emailDeliveryEnabled = false
    mocks.usePushNotifications.mockReturnValue({
      supported: true,
      configured: true,
      iosHomeScreenRequired: false,
      permission: 'default',
      enabled: false,
      enable: mocks.enable.mockRejectedValue(new Error('denied')),
    })
    const user = userEvent.setup()
    render(<PushNotificationOnboarding />)
    await screen.findByTestId('push-notification-onboarding')
    await user.click(
      screen.getByRole('button', { name: /enable push notifications/i }),
    )

    expect(
      await screen.findByText(/email delivery is turned off on this instance/i),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/only notifications configured for email/i),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument()
  })

  it('does not prompt when browser permission is already denied', async () => {
    mocks.usePushNotifications.mockReturnValue({
      supported: true,
      configured: true,
      iosHomeScreenRequired: false,
      permission: 'denied',
      enabled: false,
      enable: mocks.enable,
    })
    render(<PushNotificationOnboarding />)

    await new Promise((resolve) => window.setTimeout(resolve, 800))
    expect(screen.queryByTestId('push-notification-onboarding')).toBeNull()
  })

  it('keeps onboarding active and retryable when saving the email preference fails', async () => {
    mocks.savePreferences
      .mockRejectedValueOnce(new Error('save failed'))
      .mockResolvedValueOnce(undefined)
    const user = userEvent.setup()
    render(<PushNotificationOnboarding />)
    await screen.findByTestId('push-notification-onboarding')

    await user.click(screen.getByRole('button', { name: /use email/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not save notification preferences/i,
    )
    expect(
      screen.getByTestId('push-notification-onboarding'),
    ).toBeInTheDocument()
    expect(localStorage.getItem(PUSH_ONBOARDING_ACTIVE_KEY)).not.toBeNull()
    expect(
      localStorage.getItem(`${PUSH_ONBOARDING_COMPLETE_PREFIX}account-1`),
    ).toBeNull()

    await user.click(screen.getByRole('button', { name: /try again/i }))

    await waitFor(() => {
      expect(screen.queryByTestId('push-notification-onboarding')).toBeNull()
    })
    expect(mocks.savePreferences).toHaveBeenCalledTimes(2)
  })

  it('allows dismissal after an email preference save failure without completing onboarding', async () => {
    mocks.savePreferences.mockRejectedValue(new Error('save failed'))
    const user = userEvent.setup()
    render(<PushNotificationOnboarding />)
    await screen.findByTestId('push-notification-onboarding')
    await user.click(screen.getByRole('button', { name: /use email/i }))
    await screen.findByRole('alert')

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByTestId('push-notification-onboarding')).toBeNull()
    })
    expect(localStorage.getItem(PUSH_ONBOARDING_ACTIVE_KEY)).toBeNull()
    expect(
      localStorage.getItem(`${PUSH_ONBOARDING_COMPLETE_PREFIX}account-1`),
    ).toBeNull()
  })
})
