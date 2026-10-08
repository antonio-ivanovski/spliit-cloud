import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen, waitFor } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  getPushRegistration: vi.fn(),
  getPushSubscription: vi.fn(),
  subscribeToPush: vi.fn(),
  serializePushSubscription: vi.fn(),
  register: vi.fn(),
  remove: vi.fn(),
  invalidateStatus: vi.fn(),
  invalidatePreferences: vi.fn(),
  currentAccount: vi.fn(),
  getConfigOptions: null as null | { enabled?: unknown },
  statusOptions: null as null | { enabled?: unknown },
}))

vi.mock('@/lib/push-notifications', () => ({
  disconnectPushSubscription: vi.fn(),
  getPushRegistration: mocks.getPushRegistration,
  getPushSubscription: mocks.getPushSubscription,
  isIosHomeScreenRequired: () => false,
  isPushSupported: () => true,
  serializePushSubscription: mocks.serializePushSubscription,
  subscribeToPush: mocks.subscribeToPush,
}))

vi.mock('@/lib/use-current-account', () => ({
  useCurrentAccount: mocks.currentAccount,
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      notifications: {
        push: { status: { invalidate: mocks.invalidateStatus } },
        preferences: { get: { invalidate: mocks.invalidatePreferences } },
      },
    }),
    notifications: {
      push: {
        getConfig: {
          useQuery: (_input: unknown, options?: { enabled?: unknown }) => {
            mocks.getConfigOptions = options ?? null
            return {
              data: { configured: true, vapidPublicKey: 'public-key' },
              isPending: false,
              error: null,
            }
          },
        },
        register: {
          useMutation: () => ({
            mutateAsync: mocks.register,
            isPending: false,
          }),
        },
        remove: {
          useMutation: () => ({
            mutateAsync: mocks.remove,
            isPending: false,
          }),
        },
        status: {
          useQuery: (_input: unknown, options?: { enabled?: unknown }) => {
            mocks.statusOptions = options ?? null
            return {
              data: { subscribed: true },
              isPending: false,
              isFetching: false,
              error: null,
            }
          },
        },
      },
    },
  },
}))

import { usePushNotifications } from './use-push-notifications'

function PushProbe({ name }: { name: string }) {
  const push = usePushNotifications()
  return (
    <div>
      <span data-testid={`${name}-status`}>
        {push.enabled ? 'enabled' : 'disabled'}
      </span>
      <button type="button" onClick={() => void push.enable()}>
        Enable {name}
      </button>
      <button type="button" onClick={() => void push.disable()}>
        Disable {name}
      </button>
    </div>
  )
}

describe('usePushNotifications synchronization', () => {
  let browserSubscription: PushSubscription | null

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getConfigOptions = null
    mocks.statusOptions = null
    mocks.currentAccount.mockReturnValue({
      data: {
        id: 'acct-1',
        name: 'Alice',
        email: 'alice@example.com',
        image: null,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })
    browserSubscription = null
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: { permission: 'granted' },
    })
    const subscription = {
      endpoint: 'https://push.example/subscription',
      unsubscribe: vi.fn(async () => {
        browserSubscription = null
        return true
      }),
    } as unknown as PushSubscription
    mocks.getPushRegistration.mockImplementation(async () => ({}))
    mocks.getPushSubscription.mockImplementation(
      async () => browserSubscription,
    )
    mocks.subscribeToPush.mockImplementation(async () => {
      browserSubscription = subscription
      return subscription
    })
    mocks.serializePushSubscription.mockReturnValue({
      endpoint: subscription.endpoint,
      keys: { p256dh: 'p256dh', auth: 'auth' },
    })
    mocks.register.mockResolvedValue(undefined)
    mocks.remove.mockResolvedValue(undefined)
    mocks.invalidateStatus.mockResolvedValue(undefined)
    mocks.invalidatePreferences.mockResolvedValue(undefined)
  })

  it('refreshes every mounted hook after this browser is enabled or disabled', async () => {
    const user = userEvent.setup()
    render(
      <>
        <PushProbe name="onboarding" />
        <PushProbe name="settings" />
      </>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-status')).toHaveTextContent(
        'disabled',
      )
      expect(screen.getByTestId('settings-status')).toHaveTextContent(
        'disabled',
      )
    })

    await user.click(screen.getByRole('button', { name: 'Enable onboarding' }))

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-status')).toHaveTextContent(
        'enabled',
      )
      expect(screen.getByTestId('settings-status')).toHaveTextContent('enabled')
    })

    await user.click(screen.getByRole('button', { name: 'Disable onboarding' }))

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-status')).toHaveTextContent(
        'disabled',
      )
      expect(screen.getByTestId('settings-status')).toHaveTextContent(
        'disabled',
      )
    })
  })

  it('fetches push config when signed in', async () => {
    render(<PushProbe name="signed-in" />)

    await waitFor(() => {
      expect(screen.getByTestId('signed-in-status')).toBeInTheDocument()
    })
    expect(mocks.getConfigOptions?.enabled).toBe(true)
  })

  it('does not fetch push config or status when signed out', async () => {
    mocks.currentAccount.mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })
    render(<PushProbe name="signed-out" />)

    await waitFor(() => {
      expect(screen.getByTestId('signed-out-status')).toBeInTheDocument()
    })
    expect(mocks.getConfigOptions?.enabled).toBe(false)
    expect(mocks.statusOptions?.enabled).toBe(false)
  })
})
