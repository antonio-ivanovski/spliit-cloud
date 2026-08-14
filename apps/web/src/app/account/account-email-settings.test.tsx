import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen, waitFor } from '@/test/test-utils'

import { AccountEmailSettings } from './account-email-settings'

const { confirmMock, requestMock, toastMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(),
  requestMock: vi.fn(),
  toastMock: vi.fn(),
}))

vi.mock('@/lib/email-change', async () => {
  class EmailChangeError extends Error {
    constructor(
      public readonly code: string,
      public readonly status: number,
    ) {
      super(code)
    }
  }
  return {
    EmailChangeError,
    confirmEmailChange: confirmMock,
    requestEmailChange: requestMock,
  }
})

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}))

describe('AccountEmailSettings', () => {
  const onUpdated = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    onUpdated.mockResolvedValue(undefined)
    requestMock.mockResolvedValue({ sent: true })
    confirmMock.mockResolvedValue({
      success: true,
      email: 'new@example.com',
      isAnonymous: false,
    })
  })

  it('shows a real email as text with a change action', async () => {
    const { user } = render(
      <AccountEmailSettings
        email="user@example.com"
        isAnonymous={false}
        onUpdated={onUpdated}
      />,
    )

    expect(screen.getByText('user@example.com')).toBeInTheDocument()
    expect(
      screen.queryByDisplayValue('user@example.com'),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Change email' }))

    expect(
      screen.getByRole('heading', { name: 'Change your email' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/anyone with the saved URL/i),
    ).not.toBeInTheDocument()
  })

  it('hides a GitHub placeholder email and skips anonymous graduation copy', async () => {
    const { user } = render(
      <AccountEmailSettings
        email="789@github.placeholder.local"
        isAnonymous={false}
        onUpdated={onUpdated}
      />,
    )

    expect(screen.getByText('No email')).toBeInTheDocument()
    expect(
      screen.queryByText('789@github.placeholder.local'),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add email' }))

    expect(
      screen.getByRole('heading', { name: 'Add an email address' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/anyone with the saved URL/i),
    ).not.toBeInTheDocument()
  })

  it('warns about URL recovery in the add-email modal for anonymous accounts', async () => {
    const { user } = render(
      <AccountEmailSettings
        email="guest-1@anonymous.placeholder.local"
        isAnonymous
        onUpdated={onUpdated}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Add email' }))
    expect(
      screen.getByRole('heading', { name: 'Add an email address' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'This replaces your sign-in link' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/anyone with the saved URL/i)).toBeInTheDocument()

    await user.type(screen.getByLabelText('Email address'), 'new@example.com')
    await user.click(screen.getByRole('button', { name: 'Send code' }))

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith({
        email: 'new@example.com',
        acknowledgedGraduation: true,
      }),
    )

    expect(screen.getByText('Code sent')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Resend in \d+s/ }),
    ).toBeDisabled()

    await user.type(screen.getByLabelText('Confirmation code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Confirm email' }))

    await waitFor(() =>
      expect(confirmMock).toHaveBeenCalledWith({
        email: 'new@example.com',
        otp: '123456',
      }),
    )
    expect(onUpdated).toHaveBeenCalled()
  })

  it('lets the user go back and change the email before confirming', async () => {
    const { user } = render(
      <AccountEmailSettings
        email="user@example.com"
        isAnonymous={false}
        onUpdated={onUpdated}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Change email' }))
    await user.type(screen.getByLabelText('Email address'), 'typo@example.com')
    await user.click(screen.getByRole('button', { name: 'Send code' }))

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith({
        email: 'typo@example.com',
      }),
    )

    await user.click(
      screen.getByRole('button', { name: 'Use a different email' }),
    )
    expect(screen.getByLabelText('Email address')).toHaveValue(
      'typo@example.com',
    )

    await user.clear(screen.getByLabelText('Email address'))
    await user.type(
      screen.getByLabelText('Email address'),
      'correct@example.com',
    )
    await user.click(screen.getByRole('button', { name: 'Send code' }))

    await waitFor(() =>
      expect(requestMock).toHaveBeenLastCalledWith({
        email: 'correct@example.com',
      }),
    )
  })
})
