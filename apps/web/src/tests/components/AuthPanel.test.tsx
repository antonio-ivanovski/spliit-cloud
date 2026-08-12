import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthPanel } from '@/components/auth/auth-panel'
import { render, screen } from '@/test/test-utils'

// ── Hoisted mocks ───────────────────────────────────────────────────────

const {
  mockSignInEmail,
  mockSignUpEmail,
  mockSignInMagicLink,
  mockSignInSocial,
  mockGetSession,
  mockNavigate,
  mockDeploymentConfig,
  mockMascotReact,
  mockSearch,
} = vi.hoisted(() => ({
  mockSignInEmail: vi.fn(),
  mockSignUpEmail: vi.fn(),
  mockSignInMagicLink: vi.fn(),
  mockSignInSocial: vi.fn(),
  mockGetSession: vi.fn(),
  mockNavigate: vi.fn(),
  mockDeploymentConfig: {
    defaultCurrencyCode: 'USD',
    enableGoogleOAuth: false,
    enableGitHubOAuth: false,
    signupMode: 'open' as 'open' | 'invite_only',
    allowUninvitedSignup: true,
  },
  mockMascotReact: vi.fn(),
  mockSearch: {
    redirect: undefined as string | undefined,
    mode: undefined as 'sign-in' | 'sign-up' | undefined,
    email: undefined as string | undefined,
    invitation: undefined as string | undefined,
  },
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

vi.mock('@/lib/deployment-config', () => ({
  useDeploymentConfig: () => mockDeploymentConfig,
}))

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => mockSearch,
  useNavigate: () => mockNavigate,
  Link: ({ to, children, ...props }: Record<string, unknown>) => (
    <a href={to as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}))

vi.mock('@/components/mascot/mascot-context', async () => {
  const actual = await vi.importActual('@/components/mascot/mascot-context')
  return {
    ...actual,
    useMascotController: () => ({
      react: mockMascotReact,
      clearThinking: vi.fn(),
    }),
  }
})

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
    mockDeploymentConfig.enableGoogleOAuth = false
    mockDeploymentConfig.enableGitHubOAuth = false
    mockDeploymentConfig.signupMode = 'open'
    mockDeploymentConfig.allowUninvitedSignup = true
    mockSearch.redirect = undefined
    mockSearch.mode = undefined
    mockSearch.email = undefined
    mockSearch.invitation = undefined
  })

  // ── Mode switching ──────────────────────────────────────────────────

  it('renders sign-in title by default', () => {
    render(<AuthPanel />)
    expect(screen.getByText('Sign in to Spliit Cloud')).toBeInTheDocument()
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
    expect(screen.getByRole('tab', { name: /magic link/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByText('Send sign-in link')).toBeInTheDocument()
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
    const submitButton = screen
      .getByText('Sign in with password')
      .closest('button')
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
    expect(mockMascotReact).toHaveBeenCalledWith('failure')
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
    expect(screen.getByText('Use a different email')).toBeInTheDocument()
    expect(mockMascotReact).toHaveBeenCalledWith('success')
  })

  // ── Social buttons ──────────────────────────────────────────────────

  it('social buttons appear when feature flags are enabled', () => {
    mockDeploymentConfig.enableGoogleOAuth = true
    mockDeploymentConfig.enableGitHubOAuth = true

    render(<AuthPanel />)

    expect(screen.getByText('Continue with Google')).toBeInTheDocument()
    expect(screen.getByText('Continue with GitHub')).toBeInTheDocument()
  })

  it('returns social sign-in to an overridden OAuth continuation path', async () => {
    mockDeploymentConfig.enableGoogleOAuth = true
    const redirectTo =
      '/oauth/login?oauth_query=client_id%3Dassistant-client%26scope%3Dopenid'
    const { user } = render(<AuthPanel embedded redirectTo={redirectTo} />)

    await user.click(screen.getByText('Continue with Google'))

    expect(mockSignInSocial).toHaveBeenCalledWith(
      {
        provider: 'google',
        callbackURL: `${window.location.origin}${redirectTo}`,
      },
      {},
    )
    expect(
      screen.queryByText('Sign in to Spliit Cloud'),
    ).not.toBeInTheDocument()
  })

  // ── Forgot password link ────────────────────────────────────────────

  it('sign-in mode renders forgot password link', async () => {
    const { user } = render(<AuthPanel />)
    await switchToPasswordTab(user)

    // The "Forgot password?" link is only rendered in sign-in mode (default)
    expect(screen.getByText('Forgot password?')).toBeInTheDocument()
  })

  it('hides sign-up when the instance is invite-only', () => {
    mockDeploymentConfig.signupMode = 'invite_only'
    mockDeploymentConfig.allowUninvitedSignup = false

    render(<AuthPanel />)

    expect(screen.queryByText('Create an account')).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'This instance is invite-only. Use an invitation link or ask someone to invite you to a group.',
      ),
    ).toBeInTheDocument()
  })

  it('shows sign-up when invite-only but the visitor has a link invite', async () => {
    mockDeploymentConfig.signupMode = 'invite_only'
    mockDeploymentConfig.allowUninvitedSignup = false
    mockSearch.redirect = '/groups/grp-1?invite=abcDEF-_0123456789'

    const { user } = render(<AuthPanel />)

    expect(
      screen.getByText('Create your Spliit Cloud account'),
    ).toBeInTheDocument()
    await user.click(screen.getByText('Sign in'))
    expect(screen.getByText('Create an account')).toBeInTheDocument()
  })
})
