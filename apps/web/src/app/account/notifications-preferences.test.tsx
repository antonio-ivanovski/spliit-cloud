import { render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  usePreferencesQuery: vi.fn(),
  savePreferences: vi.fn(),
  invalidatePreferences: vi.fn(),
  useCurrentAccount: vi.fn(),
  usePushNotifications: vi.fn(),
  enablePush: vi.fn(),
  toast: vi.fn(),
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

import { NotificationsPreferences } from './notifications-preferences'

type MockPreferenceData = {
  categories: Array<{
    category: string
    channels: string[] | null
    recommendedChannels: string[]
  }>
  hasPushTargets: boolean
  isPushConfigured: boolean
}

function makeData(
  overrides: Partial<MockPreferenceData> = {},
): MockPreferenceData {
  return {
    categories: [
      {
        category: 'GROUP_INVITE_RECEIVED',
        channels: null,
        recommendedChannels: ['EMAIL', 'PUSH'],
      },
      {
        category: 'FRIEND_ADDED',
        channels: null,
        recommendedChannels: ['EMAIL', 'PUSH'],
      },
      {
        category: 'EXPENSE_CREATED',
        channels: null,
        recommendedChannels: ['PUSH'],
      },
      {
        category: 'EXPENSE_CHANGED',
        channels: null,
        recommendedChannels: ['PUSH'],
      },
      {
        category: 'EXPENSE_COMMENT',
        channels: null,
        recommendedChannels: ['PUSH'],
      },
      {
        category: 'WEEKLY_SUMMARY',
        channels: null,
        recommendedChannels: ['EMAIL'],
      },
      {
        category: 'PRODUCT_UPDATES',
        channels: null,
        recommendedChannels: ['EMAIL'],
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

    expect(
      screen.getByRole('heading', { name: 'Groups and friends' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Expenses' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Summaries' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Added to a group')).toBeInTheDocument()
    expect(screen.getByText('Friend ledger')).toBeInTheDocument()
    expect(screen.getByText('New comment')).toBeInTheDocument()
    expect(screen.getAllByRole('combobox')).toHaveLength(4)
    expect(screen.getAllByText('Coming soon').length).toBeGreaterThan(0)
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
        preferences: [{ category: 'FRIEND_ADDED', channels: null }],
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

  it('warns when Push is selected but no device target exists', () => {
    mocks.usePreferencesQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: makeData({ hasPushTargets: false }),
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
      data: makeData({ hasPushTargets: false }),
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
