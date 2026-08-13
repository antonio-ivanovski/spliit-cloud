import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen, waitFor } from '@/test/test-utils'

import { AnonymousAccountSettings } from './anonymous-account-settings'

const { activateMock, startMock, toastMock } = vi.hoisted(() => ({
  activateMock: vi.fn(),
  startMock: vi.fn(),
  toastMock: vi.fn(),
}))

vi.mock('@/lib/anonymous-recovery', () => ({
  activateAnonymousRecoveryRotation: activateMock,
  startAnonymousRecoveryRotation: startMock,
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}))

describe('AnonymousAccountSettings', () => {
  const replacementLink =
    'https://app.example/auth/recover#code=spliit_anonymous_v1_replacement'

  beforeEach(() => {
    vi.clearAllMocks()
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
})
