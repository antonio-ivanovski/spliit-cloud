import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen, waitFor, within } from '@/test/test-utils'

import { AccountPasskeySettings } from './account-passkey-settings'

const {
  addMock,
  listMock,
  removeMock,
  notifyMock,
  toastMock,
  passkeySupported,
  recoveryStatusMock,
  sessionFreshnessMock,
  reauthMock,
} = vi.hoisted(() => ({
  addMock: vi.fn(),
  listMock: vi.fn(),
  removeMock: vi.fn(),
  notifyMock: vi.fn(),
  toastMock: vi.fn(),
  passkeySupported: { value: true },
  recoveryStatusMock: vi.fn(),
  sessionFreshnessMock: vi.fn(),
  reauthMock: vi.fn(),
}))

vi.mock('@/lib/passkey', async () => {
  class PasskeyError extends Error {
    constructor(
      public readonly code: string,
      public readonly status: number,
    ) {
      super(code)
    }
  }
  return {
    PasskeyError,
    addPasskey: addMock,
    getPasskeySessionFreshness: sessionFreshnessMock,
    isPasskeySupported: () => passkeySupported.value,
    listPasskeys: listMock,
    notifyPasskeyChanged: notifyMock,
    removePasskey: removeMock,
    signOutAndReturnToSignIn: reauthMock,
  }
})

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}))

vi.mock('@/lib/anonymous-recovery', () => ({
  getAnonymousRecoveryStatus: recoveryStatusMock,
}))

describe('AccountPasskeySettings', () => {
  const onUpdated = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    passkeySupported.value = true
    onUpdated.mockResolvedValue(undefined)
    notifyMock.mockResolvedValue(undefined)
    listMock.mockResolvedValue([])
    addMock.mockResolvedValue({ id: 'pk-1', name: 'MacBook' })
    removeMock.mockResolvedValue(undefined)
    sessionFreshnessMock.mockResolvedValue(true)
    reauthMock.mockResolvedValue(undefined)
    recoveryStatusMock.mockResolvedValue({
      isAnonymous: true,
      hasRecoveryKey: true,
      acknowledged: true,
      onboardingCompleted: true,
      canResumeSetup: false,
      hasPasskey: true,
    })
  })

  it('lists registered passkeys with metadata and offers adding another', async () => {
    listMock.mockResolvedValue([
      {
        id: 'pk-1',
        name: 'MacBook Touch ID',
        createdAt: '2026-09-01T00:00:00.000Z',
        deviceType: 'singleDevice',
        backedUp: false,
      },
      {
        id: 'pk-2',
        name: null,
        createdAt: '2026-09-02T00:00:00.000Z',
        deviceType: 'multiDevice',
        backedUp: true,
      },
    ])
    render(<AccountPasskeySettings isAnonymous={false} onUpdated={onUpdated} />)

    expect(await screen.findByText('MacBook Touch ID')).toBeInTheDocument()
    expect(screen.getByText('Passkey')).toBeInTheDocument()
    expect(screen.getByText('This device only')).toBeInTheDocument()
    expect(screen.getByText('Synced')).toBeInTheDocument()
    expect(screen.getByText('Backed up')).toBeInTheDocument()
    expect(screen.getAllByText(/2026/).length).toBe(2)
    expect(
      screen.getByRole('button', { name: 'Add a passkey' }),
    ).toBeInTheDocument()
  })

  it('offers no rename action', async () => {
    listMock.mockResolvedValue([
      {
        id: 'pk-1',
        name: 'Old name',
        createdAt: '2026-09-01T00:00:00.000Z',
        deviceType: 'singleDevice',
        backedUp: false,
      },
    ])
    render(<AccountPasskeySettings isAnonymous={false} onUpdated={onUpdated} />)

    expect(await screen.findByText('Old name')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Rename' }),
    ).not.toBeInTheDocument()
  })

  it('shows the empty state when no passkey is registered', async () => {
    render(<AccountPasskeySettings isAnonymous={false} onUpdated={onUpdated} />)

    expect(await screen.findByText('No passkeys yet.')).toBeInTheDocument()
  })

  it('adds a passkey with an optional name', async () => {
    const { user } = render(
      <AccountPasskeySettings isAnonymous={false} onUpdated={onUpdated} />,
    )

    await user.click(
      await screen.findByRole('button', { name: 'Add a passkey' }),
    )
    const dialog = await screen.findByRole('dialog')
    await user.type(
      within(dialog).getByLabelText(/name \(optional\)/i),
      'MacBook',
    )
    await user.click(
      within(dialog).getByRole('button', { name: 'Add passkey' }),
    )

    expect(addMock).toHaveBeenCalledWith('MacBook')
    await waitFor(() => expect(onUpdated).toHaveBeenCalled())
    expect(notifyMock).toHaveBeenCalled()
    expect(toastMock).toHaveBeenCalledWith({ description: 'Passkey added.' })
  })

  it('opens the re-auth modal instead of the add dialog on a stale session', async () => {
    sessionFreshnessMock.mockResolvedValueOnce(false)
    const { user } = render(
      <AccountPasskeySettings isAnonymous={false} onUpdated={onUpdated} />,
    )

    await user.click(
      await screen.findByRole('button', { name: 'Add a passkey' }),
    )

    expect(
      await screen.findByText('Sign in again to add a passkey'),
    ).toBeInTheDocument()
    expect(addMock).not.toHaveBeenCalled()
    expect(
      screen.queryByLabelText(/name \(optional\)/i),
    ).not.toBeInTheDocument()
  })

  it('signs out and returns to sign-in from the re-auth modal', async () => {
    sessionFreshnessMock.mockResolvedValueOnce(false)
    const { user } = render(
      <AccountPasskeySettings isAnonymous={false} onUpdated={onUpdated} />,
    )

    await user.click(
      await screen.findByRole('button', { name: 'Add a passkey' }),
    )
    await user.click(
      await screen.findByRole('button', { name: 'Sign in again' }),
    )

    expect(reauthMock).toHaveBeenCalledOnce()
  })

  it('routes a mid-ceremony stale failure to the re-auth modal', async () => {
    const { PasskeyError } = await import('@/lib/passkey')
    addMock.mockRejectedValueOnce(
      new PasskeyError('PASSKEY_SESSION_STALE', 403),
    )
    const { user } = render(
      <AccountPasskeySettings isAnonymous={false} onUpdated={onUpdated} />,
    )

    await user.click(
      await screen.findByRole('button', { name: 'Add a passkey' }),
    )
    const dialog = await screen.findByRole('dialog')
    await user.click(
      within(dialog).getByRole('button', { name: 'Add passkey' }),
    )

    expect(
      await screen.findByText('Sign in again to add a passkey'),
    ).toBeInTheDocument()
  })

  it('toasts when the re-auth sign-out fails', async () => {
    sessionFreshnessMock.mockResolvedValueOnce(false)
    reauthMock.mockRejectedValueOnce(new Error('offline'))
    const { user } = render(
      <AccountPasskeySettings isAnonymous={false} onUpdated={onUpdated} />,
    )

    await user.click(
      await screen.findByRole('button', { name: 'Add a passkey' }),
    )
    await user.click(
      await screen.findByRole('button', { name: 'Sign in again' }),
    )

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({
        description: 'Something went wrong. Try again.',
        variant: 'destructive',
      }),
    )
  })

  it('warns instead of signing out for guests with no way back in', async () => {
    sessionFreshnessMock.mockResolvedValueOnce(false)
    recoveryStatusMock.mockResolvedValueOnce({
      isAnonymous: true,
      hasRecoveryKey: false,
      acknowledged: true,
      onboardingCompleted: true,
      canResumeSetup: false,
      hasPasskey: false,
    })
    const { user } = render(
      <AccountPasskeySettings isAnonymous onUpdated={onUpdated} />,
    )

    await user.click(
      await screen.findByRole('button', { name: 'Add a passkey' }),
    )

    expect(
      await screen.findByText('Save a sign-in link first'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Sign in again' }),
    ).not.toBeInTheDocument()
    expect(reauthMock).not.toHaveBeenCalled()
  })

  it('offers re-auth to guests that already have a sign-in link', async () => {
    sessionFreshnessMock.mockResolvedValueOnce(false)
    const { user } = render(
      <AccountPasskeySettings isAnonymous onUpdated={onUpdated} />,
    )

    await user.click(
      await screen.findByRole('button', { name: 'Add a passkey' }),
    )

    expect(
      await screen.findByRole('button', { name: 'Sign in again' }),
    ).toBeInTheDocument()
  })

  it('closes the modal on post-sign-out navigation failure', async () => {
    const { PasskeyError } = await import('@/lib/passkey')
    sessionFreshnessMock.mockResolvedValueOnce(false)
    reauthMock.mockRejectedValueOnce(
      new PasskeyError('PASSKEY_REAUTH_NAVIGATE_FAILED', 0),
    )
    const { user } = render(
      <AccountPasskeySettings isAnonymous={false} onUpdated={onUpdated} />,
    )

    await user.click(
      await screen.findByRole('button', { name: 'Add a passkey' }),
    )
    await user.click(
      await screen.findByRole('button', { name: 'Sign in again' }),
    )

    await waitFor(() =>
      expect(
        screen.queryByText('Sign in again to add a passkey'),
      ).not.toBeInTheDocument(),
    )
    expect(toastMock).toHaveBeenCalledWith({
      description: 'Something went wrong. Try again.',
      variant: 'destructive',
    })
  })

  it('removes a passkey after confirmation', async () => {
    listMock.mockResolvedValue([
      {
        id: 'pk-1',
        name: 'Old key',
        createdAt: '2026-09-01T00:00:00.000Z',
        deviceType: 'singleDevice',
        backedUp: false,
      },
      {
        id: 'pk-2',
        name: 'Other key',
        createdAt: '2026-09-02T00:00:00.000Z',
        deviceType: 'singleDevice',
        backedUp: false,
      },
    ])
    const { user } = render(
      <AccountPasskeySettings isAnonymous={false} onUpdated={onUpdated} />,
    )

    expect(await screen.findByText('Old key')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Remove' })[0])

    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByText(/this cannot be undone/i),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    expect(removeMock).toHaveBeenCalledWith('pk-1')
    await waitFor(() => expect(onUpdated).toHaveBeenCalled())
    expect(toastMock).toHaveBeenCalledWith({ description: 'Passkey removed.' })
  })

  it('warns when removing the last passkey and surfaces the guard', async () => {
    listMock.mockResolvedValue([
      {
        id: 'pk-1',
        name: 'Only key',
        createdAt: '2026-09-01T00:00:00.000Z',
        deviceType: 'singleDevice',
        backedUp: false,
      },
    ])
    const { PasskeyError } = await import('@/lib/passkey')
    removeMock.mockRejectedValueOnce(
      new PasskeyError('PASSKEY_LAST_METHOD', 409),
    )
    const { user } = render(
      <AccountPasskeySettings isAnonymous={false} onUpdated={onUpdated} />,
    )

    expect(await screen.findByText('Only key')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/your last passkey/i)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    expect(
      await within(dialog).findByText(/save a recovery link or add another/i),
    ).toBeInTheDocument()
    expect(toastMock).not.toHaveBeenCalledWith({
      description: 'Passkey removed.',
    })
    expect(onUpdated).not.toHaveBeenCalled()
  })

  it('explains passkeys to anonymous accounts', async () => {
    render(<AccountPasskeySettings isAnonymous onUpdated={onUpdated} />)

    expect(
      await screen.findByText(
        /guest account sign in without the recovery link/i,
      ),
    ).toBeInTheDocument()
  })

  it('points link-less anonymous accounts at creating one', async () => {
    recoveryStatusMock.mockResolvedValue({
      isAnonymous: true,
      hasRecoveryKey: false,
      acknowledged: false,
      onboardingCompleted: false,
      canResumeSetup: false,
      hasPasskey: true,
    })
    render(<AccountPasskeySettings isAnonymous onUpdated={onUpdated} />)

    expect(
      await screen.findByText(/no sign in link is saved/i),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/guest account sign in without the recovery link/i),
    ).not.toBeInTheDocument()
  })

  it('renders no separator between the header row and the item rows', async () => {
    listMock.mockResolvedValue([
      {
        id: 'pk-1',
        name: 'Only key',
        createdAt: '2026-09-01T00:00:00.000Z',
        deviceType: 'singleDevice',
        backedUp: false,
      },
    ])
    const { container } = render(
      <AccountPasskeySettings isAnonymous={false} onUpdated={onUpdated} />,
    )

    expect(await screen.findByText('Only key')).toBeInTheDocument()
    // Header row and list share a plain wrapper: the only divide-y
    // separator sits outside it, between neighboring settings rows.
    const row = container.querySelector('#account-settings-passkey')
    expect(row?.parentElement?.className ?? '').not.toContain('divide')
    expect(row?.parentElement?.querySelector('ul')).toBeInTheDocument()
  })

  it('disables adding when the platform has no WebAuthn support', async () => {
    passkeySupported.value = false
    render(<AccountPasskeySettings isAnonymous={false} onUpdated={onUpdated} />)

    expect(
      await screen.findByText(/does not support passkeys/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add a passkey' })).toBeDisabled()
    expect(listMock).not.toHaveBeenCalled()
  })
})
