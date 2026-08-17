import { afterEach, describe, expect, it, vi } from 'vitest'

import { writeLastAccount } from '@/lib/last-account'
import { render, screen } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  authClient: {
    useSession: mocks.useSession,
  },
}))

import { useCurrentAccount } from '@/lib/use-current-account'

const LAST_ACCOUNT_KEY = 'spliit:last-account'

const account = {
  id: 'user-1',
  name: 'Alice',
  email: 'alice@example.com',
  image: null,
  emailVerified: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
}

function Probe() {
  const { data } = useCurrentAccount()
  return <div data-testid="account-id">{data?.id ?? 'none'}</div>
}

describe('useCurrentAccount', () => {
  afterEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('returns the live session user', () => {
    mocks.useSession.mockReturnValue({
      data: { user: account, session: {} },
      error: null,
      isPending: false,
      isRefetching: false,
      refetch: vi.fn(),
    })

    render(<Probe />)
    expect(screen.getByTestId('account-id')).toHaveTextContent('user-1')
  })

  it('restores the last account while get-session is pending', () => {
    writeLastAccount(account)
    mocks.useSession.mockReturnValue({
      data: null,
      error: null,
      isPending: true,
      isRefetching: false,
      refetch: vi.fn(),
    })

    render(<Probe />)
    expect(screen.getByTestId('account-id')).toHaveTextContent('user-1')
  })

  it('restores the last account when get-session fails', () => {
    writeLastAccount(account)
    mocks.useSession.mockReturnValue({
      data: null,
      error: new TypeError('Failed to fetch'),
      isPending: false,
      isRefetching: false,
      refetch: vi.fn(),
    })

    render(<Probe />)
    expect(screen.getByTestId('account-id')).toHaveTextContent('user-1')
  })

  it('does not restore a snapshot on a real sign-out', () => {
    writeLastAccount(account)
    mocks.useSession.mockReturnValue({
      data: null,
      error: null,
      isPending: false,
      isRefetching: false,
      refetch: vi.fn(),
    })

    render(<Probe />)
    expect(screen.getByTestId('account-id')).toHaveTextContent('none')
    expect(localStorage.getItem(LAST_ACCOUNT_KEY)).toBeNull()
  })
})
