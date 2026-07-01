import { render, screen } from '@/test/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ResetPasswordPage } from '@/app/auth/reset-password'

// ── Hoisted mocks ───────────────────────────────────────────────────────

const { mockResetPassword, mockNavigate } = vi.hoisted(() => ({
  mockResetPassword: vi.fn(),
  mockNavigate: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  authClient: {
    resetPassword: mockResetPassword,
  },
}))

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useSearch: () => ({
      token: 'valid-token',
      error: undefined,
    }),
  }),
  useNavigate: () => mockNavigate,
  Link: ({ to, children, ...props }: Record<string, unknown>) => (
    <a href={to as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}))

// ── Tests ───────────────────────────────────────────────────────────────

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows password fields', () => {
    render(<ResetPasswordPage />)

    expect(screen.getByText('Choose a new password')).toBeInTheDocument()
    expect(screen.getByLabelText('New password')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm new password')).toBeInTheDocument()
    expect(screen.getByText('Save new password')).toBeInTheDocument()
  })

  it('shows password checklist (same as AuthPanel)', () => {
    render(<ResetPasswordPage />)

    // The PasswordChecklist component renders 5 requirements
    expect(screen.getByText('8 characters')).toBeInTheDocument()
    expect(screen.getByText('Uppercase')).toBeInTheDocument()
    expect(screen.getByText('Lowercase')).toBeInTheDocument()
    expect(screen.getByText('Number')).toBeInTheDocument()
    expect(screen.getByText('Symbol')).toBeInTheDocument()
  })

  it('send button disabled when passwords mismatch', async () => {
    const { user } = render(<ResetPasswordPage />)

    const passwordInput = screen.getByLabelText('New password')
    await user.type(passwordInput, 'StrongPass1!')

    const confirmInput = screen.getByLabelText('Confirm new password')
    await user.type(confirmInput, 'StrongPass2!')

    // The button should be disabled when passwords don't match
    const submitButton = screen.getByText('Save new password').closest('button')
    expect(submitButton).toBeDisabled()
  })

  it('submission error shows alert', async () => {
    // Suppress the expected unhandled rejection from mutateAsync
    const onUnhandled = (_reason: unknown) => {
      // swallow — the mutation error is expected
    }
    process.on('unhandledRejection', onUnhandled)

    mockResetPassword.mockResolvedValue({ error: { code: 'INVALID_TOKEN' } })

    const { user } = render(<ResetPasswordPage />)

    const passwordInput = screen.getByLabelText('New password')
    await user.type(passwordInput, 'StrongPass1!')

    const confirmInput = screen.getByLabelText('Confirm new password')
    await user.type(confirmInput, 'StrongPass1!')

    await user.click(screen.getByText('Save new password'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'This reset link has expired or already been used.',
    )

    process.removeListener('unhandledRejection', onUnhandled)
  })
})
