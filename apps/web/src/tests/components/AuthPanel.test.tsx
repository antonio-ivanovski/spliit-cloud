import { render, screen, waitFor } from '@/test/test-utils'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { AuthPanel } from '@/components/auth/auth-panel'

// ── Hoisted mocks ───────────────────────────────────────────────────────

const {
  mockSignInEmail,
  mockSignUpEmail,
  mockSignInMagicLink,
  mockSignInSocial,
  mockGetSession,
  mockNavigate,
} = vi.hoisted(() => ({
  mockSignInEmail: vi.fn(),
  mockSignUpEmail: vi.fn(),
  mockSignInMagicLink: vi.fn(),
  mockSignInSocial: vi.fn(),
  mockGetSession: vi.fn(),
  mockNavigate: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  authClient: {
    signIn: {
      email: mockSignInEmail,
      magicLink: mockSignInMagicLink,
      social: mockSignInSocial,
    },
    signUp: {
      email: mockSignUpEmail,
    },
    getSession: mockGetSession,
  },
}))

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useSearch: () => ({
      redirect: undefined,
      mode: undefined,
      email: undefined,
    }),
  }),
  useNavigate: () => mockNavigate,
  Link: ({ to, children, ...props }: Record<string, unknown>) => (
    <a href={to as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}))

// ── Helpers ─────────────────────────────────────────────────────────────

async function switchToSignUp(user: ReturnType<typeof render>['user']) {
  await user.click(screen.getByText('Create an account'))
}

async function switchToPasswordTab(user: ReturnType<typeof render>['user']) {
  await user.click(screen.getByRole('tab', { name: /password/i }))
}

async function fillEmail(
  user: ReturnType<typeof render>['user'],
  email: string,
) {
  const input = screen.getByLabelText('Email')
  await user.type(input, email)
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('AuthPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset feature flags to defaults
    import.meta.env.VITE_ENABLE_GOOGLE_OAUTH = 'false'
    import.meta.env.VITE_ENABLE_GITHUB_OAUTH = 'false'
  })

  // ── Mode switching ──────────────────────────────────────────────────

  it('renders sign-in title by default', () => {
    render(<AuthPanel />)
    expect(
      screen.getByText('Sign in to Spliit Cloud'),
    ).toBeInTheDocument()
  })

  it('switch mode button switches to sign-up', async () => {
    const { user } = render(<AuthPanel />)

    await switchToSignUp(user)

    expect(
      screen.getByText('Create your Spliit Cloud account'),
    ).toBeInTheDocument()
    // The switch text should now say "Sign in"
    expect(screen.getByText('Sign in')).toBeInTheDocument()
  })

  // ── Password checklist ──────────────────────────────────────────────

  it('shows password checklist in sign-up mode with 5 requirements', async () => {
    const { user } = render(<AuthPanel />)
    await switchToSignUp(user)
    await switchToPasswordTab(user)

    expect(screen.getByText('8 characters')).toBeInTheDocument()
    expect(screen.getByText('Uppercase')).toBeInTheDocument()
    expect(screen.getByText('Lowercase')).toBeInTheDocument()
    expect(screen.getByText('Number')).toBeInTheDocument()
    expect(screen.getByText('Symbol')).toBeInTheDocument()
  })

  it('password requirements update as user types', async () => {
    const { user } = render(<AuthPanel />)
    await switchToSignUp(user)
    await switchToPasswordTab(user)

    const passwordInput = screen.getByLabelText('Password')
    await user.type(passwordInput, 'Abc1!')

    // All 5 labels still present after input changes
    expect(screen.getByText('8 characters')).toBeInTheDocument()
    expect(screen.getByText('Uppercase')).toBeInTheDocument()
    expect(screen.getByText('Lowercase')).toBeInTheDocument()
    expect(screen.getByText('Number')).toBeInTheDocument()
    expect(screen.getByText('Symbol')).toBeInTheDocument()

    // "Abc1!" (5 chars) does NOT meet "8 characters" — the li should
    // lack the `text-foreground` class (met indicator).
    const minLengthItem = screen.getByText('8 characters').closest('li')
    expect(minLengthItem?.className).not.toContain('text-foreground')

    // "Abc1!" meets "Uppercase" — the li should have `text-foreground`.
    const uppercaseItem = screen.getByText('Uppercase').closest('li')
    expect(uppercaseItem?.className).toContain('text-foreground')
  })

  // ── Confirm password mismatch ───────────────────────────────────────

  it('shows confirm password mismatch hint', async () => {
    const { user } = render(<AuthPanel />)
    await switchToSignUp(user)
    await switchToPasswordTab(user)

    const passwordInput = screen.getByLabelText('Password')
    await user.type(passwordInput, 'StrongPass1!')

    const confirmInput = screen.getByLabelText('Confirm password')
    await user.type(confirmInput, 'StrongPass2!')

    expect(screen.getByText("Passwords don't match.")).toBeInTheDocument()
  })

  // ── Email variant tabs ──────────────────────────────────────────────

  it('magic link tab shows email form + send button', () => {
    render(<AuthPanel />)

    // Magic-link tab is the default
    expect(
      screen.getByRole('tab', { name: /magic link/i }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(
      screen.getByText('Send sign-in link'),
    ).toBeInTheDocument()
  })

  it('password tab shows email + password fields', async () => {
    const { user } = render(<AuthPanel />)
    await switchToPasswordTab(user)

    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })

  // ── Submit button states ────────────────────────────────────────────

  it('canSubmit is false with empty email', () => {
    render(<AuthPanel />)
    // Magic-link send button should be disabled when email is empty
    const sendButton = screen.getByText('Send sign-in link').closest('button')
    expect(sendButton).toBeDisabled()
  })

  it('canSubmit is true with valid sign-in creds', async () => {
    const { user } = render(<AuthPanel />)
    await switchToPasswordTab(user)

    // Fill email and password
    await fillEmail(user, 'test@example.com')
    const passwordInput = screen.getByLabelText('Password')
    await user.type(passwordInput, 'mypassword')

    // Submit button should be enabled
    const submitButton = screen.getByText('Sign in with password').closest('button')
    expect(submitButton).toBeEnabled()
  })

  // ── Error display ───────────────────────────────────────────────────

  it('error message renders with role="alert"', async () => {
    const { user } = render(<AuthPanel />)

    await fillEmail(user, 'test@example.com')
    mockSignInMagicLink.mockResolvedValue({ error: 'failed' })

    await user.click(screen.getByText('Send sign-in link'))

    const alert = await screen.findByRole('alert')
    expect(alert).toBeInTheDocument()
  })

  // ── Magic link success ──────────────────────────────────────────────

  it('magic link success shows success card with email', async () => {
    const { user } = render(<AuthPanel />)

    mockSignInMagicLink.mockResolvedValue({ error: null })

    await fillEmail(user, 'alice@example.com')
    await user.click(screen.getByText('Send sign-in link'))

    // After success the card shows the email and the success message
    expect(
      await screen.findByText('Check your inbox for a sign-in link.'),
    ).toBeInTheDocument()
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    // "Use a different email" button should appear in success state
    expect(
      screen.getByText('Use a different email'),
    ).toBeInTheDocument()
  })

  // ── Social buttons ──────────────────────────────────────────────────

  it('social buttons appear when feature flags are enabled', () => {
    import.meta.env.VITE_ENABLE_GOOGLE_OAUTH = 'true'
    import.meta.env.VITE_ENABLE_GITHUB_OAUTH = 'true'

    render(<AuthPanel />)

    expect(screen.getByText('Continue with Google')).toBeInTheDocument()
    expect(screen.getByText('Continue with GitHub')).toBeInTheDocument()
  })

  // ── Forgot password link ────────────────────────────────────────────

  it('sign-in mode renders forgot password link', async () => {
    const { user } = render(<AuthPanel />)
    await switchToPasswordTab(user)

    // The "Forgot password?" link is only rendered in sign-in mode (default)
    expect(
      screen.getByText('Forgot password?'),
    ).toBeInTheDocument()
  })
})
