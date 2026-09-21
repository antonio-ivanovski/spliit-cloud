import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AnonymousRecoveryError } from '@/lib/anonymous-recovery'
import { render, screen, waitFor, within } from '@/test/test-utils'

import { AnonymousAccountSettings } from './anonymous-account-settings'

const {
  acknowledgeMock,
  activateMock,
  revokeMock,
  setupCreateMock,
  startMock,
  statusMock,
  toastMock,
} = vi.hoisted(() => ({
  acknowledgeMock: vi.fn(),
  activateMock: vi.fn(),
  revokeMock: vi.fn(),
  setupCreateMock: vi.fn(),
  startMock: vi.fn(),
  statusMock: vi.fn(),
  toastMock: vi.fn(),
}))

vi.mock('@/lib/anonymous-recovery', async () => {
  class MockRecoveryError extends Error {
    constructor(public readonly code: string) {
      super(code)
    }
  }
  return {
    AnonymousRecoveryError: MockRecoveryError,
    acknowledgeAnonymousRecovery: acknowledgeMock,
    activateAnonymousRecoveryRotation: activateMock,
    getAnonymousRecoveryStatus: statusMock,
    revokeAnonymousRecovery: revokeMock,
    setupAnonymousRecovery: setupCreateMock,
    startAnonymousRecoveryRotation: startMock,
  }
})

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}))

describe('AnonymousAccountSettings', () => {
  const replacementLink =
    'https://app.example/auth/recover#code=spliit_anonymous_v1_replacement'

  beforeEach(() => {
    vi.clearAllMocks()
    statusMock.mockResolvedValue({
      isAnonymous: true,
      hasRecoveryKey: true,
      acknowledged: true,
      onboardingCompleted: true,
      canResumeSetup: false,
      hasPasskey: true,
    })
    revokeMock.mockResolvedValue({ success: true })
    setupCreateMock.mockResolvedValue({
      code: 'spliit_anonymous_v1_created-key',
      recoveryUrl: 'https://app.example/auth/recover#code=created',
    })
    acknowledgeMock.mockResolvedValue({ success: true })
    startMock.mockResolvedValue({
      recoveryUrl: replacementLink,
      activationTicket: 'sealed-ticket',
    })
    activateMock.mockResolvedValue({ success: true })
  })

  it('keeps rotation staged until the replacement link is confirmed', async () => {
    const { user } = render(<AnonymousAccountSettings />)

    await user.click(
      screen.getByRole('button', { name: 'Replace sign in link' }),
    )
    expect(
      screen.getByText(/current sign in link keeps working/i),
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Generate replacement link' }),
    )

    expect(await screen.findByDisplayValue(replacementLink)).toBeInTheDocument()
    expect(
      screen.getByText(/Closing or refreshing discards the replacement/i),
    ).toBeInTheDocument()
    const activate = screen.getByRole('button', {
      name: 'Activate replacement',
    })
    expect(activate).toBeDisabled()

    await user.click(
      screen.getByRole('checkbox', {
        name: 'I copied and safely stored my sign in link.',
      }),
    )
    await user.click(activate)

    await waitFor(() =>
      expect(activateMock).toHaveBeenCalledWith({
        activationTicket: 'sealed-ticket',
        confirmedCopied: true,
      }),
    )
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(toastMock).toHaveBeenCalledWith({
      description: 'Your replacement sign in link is now active.',
    })
  })

  it('discards the staged replacement when the dialog closes', async () => {
    const { user } = render(<AnonymousAccountSettings />)

    await user.click(
      screen.getByRole('button', { name: 'Replace sign in link' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Generate replacement link' }),
    )
    expect(await screen.findByDisplayValue(replacementLink)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(
      screen.getByRole('button', { name: 'Replace sign in link' }),
    )

    expect(screen.queryByDisplayValue(replacementLink)).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Generate replacement link' }),
    ).toBeInTheDocument()
  })

  it('shows an error when replacement generation fails', async () => {
    startMock.mockRejectedValueOnce(new Error('failed'))
    const { user } = render(<AnonymousAccountSettings />)

    await user.click(
      screen.getByRole('button', { name: 'Replace sign in link' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Generate replacement link' }),
    )

    expect(
      await screen.findByText(
        'The sign in link could not be replaced. Please try again.',
      ),
    ).toBeInTheDocument()
  })

  it('keeps the replacement open when activation fails', async () => {
    activateMock.mockRejectedValueOnce(new Error('failed'))
    const { user } = render(<AnonymousAccountSettings />)

    await user.click(
      screen.getByRole('button', { name: 'Replace sign in link' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Generate replacement link' }),
    )
    await user.click(
      screen.getByRole('checkbox', {
        name: 'I copied and safely stored my sign in link.',
      }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Activate replacement' }),
    )

    expect(
      await screen.findByText(
        'The sign in link could not be replaced. Please try again.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(toastMock).not.toHaveBeenCalled()
  })

  it('creates a sign in link when none exists', async () => {
    statusMock.mockResolvedValue({
      isAnonymous: true,
      hasRecoveryKey: false,
      acknowledged: false,
      onboardingCompleted: false,
      canResumeSetup: false,
      hasPasskey: true,
    })
    const { user } = render(<AnonymousAccountSettings />)

    expect(
      await screen.findByRole('button', { name: 'Create sign in link' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Replace sign in link' }),
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Create sign in link' }),
    )
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByText('Create a sign in link?'),
    ).toBeInTheDocument()

    await user.click(
      within(dialog).getByRole('button', { name: 'Create sign in link' }),
    )

    expect(setupCreateMock).toHaveBeenCalled()
    expect(
      await within(dialog).findByDisplayValue(
        'https://app.example/auth/recover#code=created',
      ),
    ).toBeInTheDocument()

    await user.click(
      within(dialog).getByRole('checkbox', {
        name: 'I copied and safely stored my sign in link.',
      }),
    )
    await user.click(
      within(dialog).getByRole('button', { name: 'Save sign in link' }),
    )

    await waitFor(() =>
      expect(acknowledgeMock).toHaveBeenCalledWith({
        confirmedCopied: true,
        code: 'spliit_anonymous_v1_created-key',
      }),
    )
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(toastMock).toHaveBeenCalledWith({
      description: 'Sign in link created.',
    })
  })

  it('removes the sign in link when a passkey exists', async () => {
    const { user } = render(<AnonymousAccountSettings />)

    const remove = await screen.findByRole('button', {
      name: 'Remove sign in link',
    })
    await waitFor(() => expect(remove).toBeEnabled())

    await user.click(remove)
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByText('Remove the sign in link?'),
    ).toBeInTheDocument()

    await user.click(
      within(dialog).getByRole('button', { name: 'Remove link' }),
    )

    expect(revokeMock).toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(toastMock).toHaveBeenCalledWith({
      description: 'Sign in link removed.',
    })
  })

  it('disables removal with a reason when no passkey exists', async () => {
    statusMock.mockResolvedValue({
      isAnonymous: true,
      hasRecoveryKey: true,
      acknowledged: true,
      onboardingCompleted: true,
      canResumeSetup: false,
      hasPasskey: false,
    })
    render(<AnonymousAccountSettings />)

    expect(
      await screen.findByRole('button', { name: 'Remove sign in link' }),
    ).toBeDisabled()
    expect(
      await screen.findByText(/currently the only way back into this account/i),
    ).toBeInTheDocument()
    expect(revokeMock).not.toHaveBeenCalled()
  })

  it('surfaces the guard when the passkey vanished mid-session', async () => {
    revokeMock.mockRejectedValueOnce(
      new AnonymousRecoveryError('RECOVERY_KEY_REQUIRED', 409),
    )
    const { user } = render(<AnonymousAccountSettings />)

    const remove = await screen.findByRole('button', {
      name: 'Remove sign in link',
    })
    await waitFor(() => expect(remove).toBeEnabled())
    await user.click(remove)
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Remove link',
      }),
    )

    expect(
      await screen.findByText(/currently the only way back into this account/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(toastMock).not.toHaveBeenCalled()
  })

  it('lays Remove and Replace out in one row', async () => {
    render(<AnonymousAccountSettings />)

    const remove = await screen.findByRole('button', {
      name: 'Remove sign in link',
    })
    const group = remove.parentElement
    expect(group).toHaveClass('grid-cols-2')
    expect(
      within(group as HTMLElement).getByRole('button', {
        name: 'Replace sign in link',
      }),
    ).toBeInTheDocument()
  })
})
