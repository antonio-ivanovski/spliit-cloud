import { render, screen } from '@/test/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ForgotPasswordPage } from '@/app/auth/forgot-password'

// ── Hoisted mocks ───────────────────────────────────────────────────────

const { mockRequestPasswordReset } = vi.hoisted(() => ({
  mockRequestPasswordReset: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  authClient: {
    requestPasswordReset: mockRequestPasswordReset,
  },
}))

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useSearch: () => ({ email: undefined }),
  }),
  Link: ({ to, children, search, ...props }: Record<string, unknown>) => (
    <a href={to as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}))

// ── Tests ───────────────────────────────────────────────────────────────

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders form with email input', () => {
    render(<ForgotPasswordPage />)

    expect(screen.getByText('Reset your password')).toBeInTheDocument()
    expect(
      screen.getByText(
        "Enter your account email and we'll send you a link to choose a new password.",
      ),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByText('Send reset link')).toBeInTheDocument()
    expect(screen.getByText('Back to sign in')).toBeInTheDocument()
  })

  it('shows success message after submitting email', async () => {
    mockRequestPasswordReset.mockResolvedValue({ error: null })

    const { user } = render(<ForgotPasswordPage />)

    const emailInput = screen.getByLabelText('Email')
    await user.type(emailInput, 'alice@example.com')

    await user.click(screen.getByText('Send reset link'))

    // After successful submission, the success card appears
    expect(
      await screen.findByText(
        "If an account exists for that email, you'll receive a reset link shortly.",
      ),
    ).toBeInTheDocument()
    // "Use a different email" button should be present
    expect(screen.getByText('Use a different email')).toBeInTheDocument()
  })

  it('shows error when email is invalid', async () => {
    mockRequestPasswordReset.mockResolvedValue({ error: 'failed' })

    const { user } = render(<ForgotPasswordPage />)

    const emailInput = screen.getByLabelText('Email')
    await user.type(emailInput, 'bad@example.com')

    await user.click(screen.getByText('Send reset link'))

    // The mutation throws when result.error is truthy, so role="alert" appears
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'Could not send the reset link. Please try again.',
    )
  })
})
