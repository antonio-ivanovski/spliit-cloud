import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen, waitFor } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  usePreferencesQuery: vi.fn(),
  savePreferences: vi.fn(),
  invalidatePreferences: vi.fn(),
  useCurrentAccount: vi.fn(),
  usePushNotifications: vi.fn(),
  enablePush: vi.fn(),
  toast: vi.fn(),
  emailDeliveryEnabled: true as boolean | null,
}))

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

vi.mock('@/lib/use-current-account', () => ({
  useCurrentAccount: mocks.useCurrentAccount,
}))

vi.mock('@/lib/use-push-notifications', () => ({
  usePushNotifications: mocks.usePushNotifications,
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}))

vi.mock('@/lib/deployment-config', () => ({
  useDeploymentConfig: () => ({
    emailDeliveryEnabled: mocks.emailDeliveryEnabled,
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    hash,
    children,
    className,
  }: {
    to: string
    hash?: string
    children?: string
    className?: string
  }) => (
    <a href={hash ? `${to}#${hash}` : to} className={className}>
      {children}
    </a>
  ),
}))

import { NotificationsPreferences } from './notifications-preferences'

type MockPreferenceData = {
  hasExplicitPreferences: boolean
  categories: Array<{
    category: string
    channels: string[] | null
    recommendedChannels: string[]
    effectiveChannels?: string[]
  }>
  hasPushTargets: boolean
  isPushConfigured: boolean
}

function makeData(
  overrides: Partial<MockPreferenceData> = {},
): MockPreferenceData {
  return {
    hasExplicitPreferences: false,
    categories: [
      {
        category: 'GROUP_INVITE_RECEIVED',
        channels: null,
        recommendedChannels: ['EMAIL', 'PUSH'],
        effectiveChannels: ['EMAIL'],
      },
      {
        category: 'FRIEND_ADDED',
        channels: null,
        recommendedChannels: ['EMAIL', 'PUSH'],
        effectiveChannels: ['EMAIL'],
      },
      {
        category: 'EXPENSE_CREATED',
        channels: null,
        recommendedChannels: ['PUSH'],
        effectiveChannels: ['EMAIL'],
      },
      {
        category: 'RECURRING_EXPENSE_CREATED',
        channels: null,
        recommendedChannels: ['PUSH'],
        effectiveChannels: ['EMAIL'],
      },
      {
        category: 'EXPENSE_CHANGED',
        channels: null,
        recommendedChannels: ['PUSH'],
        effectiveChannels: ['EMAIL'],
      },
      {
        category: 'EXPENSE_COMMENT',
        channels: null,
        recommendedChannels: ['PUSH'],
        effectiveChannels: ['PUSH'],
      },
      {
        category: 'WEEKLY_SUMMARY',
        channels: null,
        recommendedChannels: ['EMAIL'],
        effectiveChannels: ['EMAIL'],
      },
      {
        category: 'PRODUCT_UPDATES',
        channels: null,
        recommendedChannels: ['EMAIL'],
        effectiveChannels: ['EMAIL'],
      },
    ],
    hasPushTargets: true,
    isPushConfigured: true,
    ...overrides,
  }
}

describe('NotificationsPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.emailDeliveryEnabled = true
    mocks.useCurrentAccount.mockReturnValue({
      data: { id: 'account-1', email: 'user@example.com' },
    })
    mocks.usePushNotifications.mockReturnValue({
      supported: true,
      configured: true,
      iosHomeScreenRequired: false,
      permission: 'granted',
      enabled: true,
      isLoading: false,
      isUpdating: false,
      enable: mocks.enablePush,
      disable: vi.fn(),
    })
    mocks.usePreferencesQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: makeData(),
      refetch: vi.fn(),
    })
    mocks.savePreferences.mockResolvedValue(undefined)
    mocks.invalidatePreferences.mockResolvedValue(undefined)
    mocks.enablePush.mockResolvedValue(undefined)
  })

  it('renders the compact three-section list and coming-soon rows', () => {
    render(<NotificationsPreferences />)

    for (const title of ['Groups and friends', 'Expenses', 'Summaries']) {
      const heading = screen.getByRole('heading', { name: title })
      expect(heading).toBeInTheDocument()
      expect(heading.tagName).toBe('H3')
    }
    expect(screen.getByText('Added to a group')).toBeInTheDocument()
    expect(screen.getByText('Friend ledger')).toBeInTheDocument()
    expect(screen.getByText('New comment')).toBeInTheDocument()
    expect(screen.getByText('Budget alerts')).toBeInTheDocument()
    expect(screen.getAllByRole('combobox')).toHaveLength(7)
    expect(screen.getAllByText('Coming soon').length).toBeGreaterThan(0)
  })

  it('points placeholder-email accounts to add a verified address', () => {
    mocks.useCurrentAccount.mockReturnValue({
      data: { id: 'account-1', email: '789@github.placeholder.local' },
    })
    render(<NotificationsPreferences />)

    expect(
      screen.getByText(/add a verified email to receive inbox notifications/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add email' })).toHaveAttribute(
      'href',
      '/account/settings#account-settings-email',
    )
  })

  it('enrolls the current device before selecting Push and saves one row', async () => {
    const data = makeData()
    data.categories[1].channels = ['EMAIL']
    mocks.usePreferencesQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data,
      refetch: vi.fn(),
    })
    mocks.usePushNotifications.mockReturnValue({
      supported: true,
      configured: true,
      iosHomeScreenRequired: false,
      permission: 'default',
      enabled: false,
      isLoading: false,
      isUpdating: false,
      enable: mocks.enablePush,
      disable: vi.fn(),
    })
    const user = userEvent.setup()
    render(<NotificationsPreferences />)

    await user.click(screen.getAllByRole('combobox')[1])
    await user.click(screen.getByRole('option', { name: 'Push' }))

    expect(mocks.enablePush).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(mocks.savePreferences).toHaveBeenCalledWith({
        preferences: [
          { category: 'FRIEND_ADDED', channels: ['EMAIL', 'PUSH'] },
        ],
      }),
    )
  })

  it('rolls back an optimistic change and reports save errors', async () => {
    mocks.savePreferences.mockRejectedValueOnce(new Error('failed'))
    const user = userEvent.setup()
    render(<NotificationsPreferences />)

    await user.click(screen.getAllByRole('combobox')[1])
    const push = screen.getByRole('option', { name: 'Push' })
    await user.click(push)
    await user.click(screen.getByRole('button', { name: 'Done' }))

    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    )
  })

  it('shows a delivery warning and locks the Email option when delivery is off', async () => {
    mocks.emailDeliveryEnabled = false
    const user = userEvent.setup()
    render(<NotificationsPreferences />)

    expect(
      screen.getByText(/your email choices are saved/i),
    ).toBeInTheDocument()
    // Stored EMAIL prefs stay visible (never stripped from the draft).
    expect(screen.getAllByRole('combobox')[0]).toHaveTextContent('Email')

    await user.click(screen.getAllByRole('combobox')[0])
    const emailOption = screen.getByRole('option', { name: 'Email' })
    expect(emailOption).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('option', { name: 'Push' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await user.click(emailOption)
    expect(mocks.savePreferences).not.toHaveBeenCalled()
  })

  it('stays neutral while delivery state is unknown', () => {
    mocks.emailDeliveryEnabled = null
    render(<NotificationsPreferences />)

    expect(
      screen.queryByText(/your email choices are saved/i),
    ).not.toBeInTheDocument()
  })

  it('warns when Push is selected but no device target exists', () => {
    const data = makeData({ hasPushTargets: false })
    data.categories[2].channels = ['PUSH']
    data.categories[2].effectiveChannels = ['PUSH']
    mocks.usePreferencesQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data,
      refetch: vi.fn(),
    })
    render(<NotificationsPreferences />)

    expect(
      screen.getAllByText(
        /push is selected, but these notifications will not be delivered/i,
      ).length,
    ).toBeGreaterThan(0)
  })

  it('surfaces disabled-device and no-target warnings separately', () => {
    const data = makeData({ hasPushTargets: false })
    data.categories[2].channels = ['PUSH']
    data.categories[2].effectiveChannels = ['PUSH']
    mocks.usePushNotifications.mockReturnValue({
      supported: true,
      configured: true,
      iosHomeScreenRequired: false,
      permission: 'granted',
      enabled: false,
      isLoading: false,
      isUpdating: false,
      enable: mocks.enablePush,
      disable: vi.fn(),
    })
    mocks.usePreferencesQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data,
      refetch: vi.fn(),
    })

    render(<NotificationsPreferences />)

    const deviceWarning = screen.getByText(
      /push is selected, but push is not enabled on this device/i,
    )
    expect(deviceWarning.parentElement).toHaveClass('text-destructive')
    expect(
      screen.getByText(/push is selected, but no device is enabled yet/i),
    ).toBeInTheDocument()
  })
})
