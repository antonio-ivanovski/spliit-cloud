import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthPanel } from '@/components/auth/auth-panel'
import { resetConnectivityForTests } from '@/lib/connectivity'
import { render, screen } from '@/test/test-utils'

// ── Hoisted mocks ───────────────────────────────────────────────────────

const {
  mockSignInEmail,
  mockSignUpEmail,
  mockSignInMagicLink,
  mockSignInSocial,
  mockSignInAnonymous,
  mockRecoverAnonymous,
  mockGetSession,
  mockNavigate,
  mockDeploymentConfig,
  mockMascotReact,
  mockSearch,
  mockGetLastUsedLoginMethod,
  mockReplaceBrowserLocation,
} = vi.hoisted(() => ({
  mockSignInEmail: vi.fn(),
  mockSignUpEmail: vi.fn(),
  mockSignInMagicLink: vi.fn(),
  mockSignInSocial: vi.fn(),
  mockSignInAnonymous: vi.fn(),
  mockRecoverAnonymous: vi.fn(),
  mockGetSession: vi.fn(),
  mockNavigate: vi.fn(),
  mockDeploymentConfig: {
    defaultCurrencyCode: 'USD',
    enableGoogleOAuth: false,
    enableGitHubOAuth: false,
    enableTwitterOAuth: false,
    oidcProviders: [] as Array<{ id: string; name: string }>,
    signupMode: 'open' as 'open' | 'invite_only',
    allowUninvitedSignup: true,
    enableAnonymousAuth: false,
    enableEmailAuth: true,
    emailDeliveryEnabled: true,
    maxExpenseDocumentSize: 2 * 1024 * 1024,
  },
  mockMascotReact: vi.fn(),
  mockGetLastUsedLoginMethod: vi.fn(),
  mockReplaceBrowserLocation: vi.fn(),
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
      anonymous: mockSignInAnonymous,
    },
    signUp: {
      email: mockSignUpEmail,
    },
    getSession: mockGetSession,
    getLastUsedLoginMethod: mockGetLastUsedLoginMethod,
  },
}))

vi.mock('@/lib/deployment-config', () => ({
  useDeploymentConfig: () => mockDeploymentConfig,
}))

vi.mock('@/lib/browser-navigation', () => ({
  replaceBrowserLocation: mockReplaceBrowserLocation,
}))

vi.mock('@/lib/anonymous-recovery', () => ({
  parseAnonymousRecoveryLink: (value: string) => {
    try {
      const url = new URL(value.trim())
      const code = new URLSearchParams(url.hash.slice(1)).get('code')
      return code && /^spliit_anonymous_v1_[A-Za-z0-9_-]{43}$/.test(code)
        ? code
        : null
    } catch {
      return null
    }
  },
  recoverAnonymousAccount: mockRecoverAnonymous,
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
    sessionStorage.clear()
    mockGetLastUsedLoginMethod.mockReturnValue(null)
    mockDeploymentConfig.enableGoogleOAuth = false
    mockDeploymentConfig.enableGitHubOAuth = false
    mockDeploymentConfig.enableTwitterOAuth = false
    mockDeploymentConfig.oidcProviders = []
    mockDeploymentConfig.signupMode = 'open'
    mockDeploymentConfig.allowUninvitedSignup = true
    mockDeploymentConfig.enableAnonymousAuth = false
    mockDeploymentConfig.enableEmailAuth = true
    mockDeploymentConfig.emailDeliveryEnabled = true
    mockSearch.redirect = undefined
    mockSearch.mode = undefined
    mockSearch.email = undefined
    mockSearch.invitation = undefined
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
    resetConnectivityForTests()
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

  it('carries a group invite through magic-link signup', async () => {
    mockDeploymentConfig.signupMode = 'invite_only'
    mockDeploymentConfig.allowUninvitedSignup = false
    mockSearch.redirect = '/groups/grp-1?invite=magic-invite-token'
    mockSignInMagicLink.mockResolvedValue({ error: null })
    const { user } = render(<AuthPanel />)

    await fillEmail(user, 'invited@example.com')
    await user.click(screen.getByText('Send sign-in link'))

    expect(mockSignInMagicLink).toHaveBeenCalledWith(
      {
        email: 'invited@example.com',
        callbackURL: `${window.location.origin}${mockSearch.redirect}`,
        newUserCallbackURL: `${window.location.origin}/auth/complete-profile?redirect=${encodeURIComponent(mockSearch.redirect)}`,
      },
      { headers: { 'X-Spliit-Invite-Token': 'magic-invite-token' } },
    )
  })

  it('carries a group invite through password signup', async () => {
    mockDeploymentConfig.signupMode = 'invite_only'
    mockDeploymentConfig.allowUninvitedSignup = false
    mockSearch.redirect = '/groups/grp-1?invite=password-invite-token'
    mockSignUpEmail.mockResolvedValue({ error: null })
    const { user } = render(<AuthPanel />)

    await switchToPasswordTab(user)
    await fillEmail(user, 'invited@example.com')
    await user.type(screen.getByLabelText('Password'), 'StrongPass1!')
    await user.type(screen.getByLabelText('Confirm password'), 'StrongPass1!')
    await user.click(screen.getByText('Sign up with password'))

    expect(mockSignUpEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'invited@example.com',
        callbackURL: `${window.location.origin}/auth/complete-profile?redirect=${encodeURIComponent(mockSearch.redirect)}`,
      }),
      { headers: { 'X-Spliit-Invite-Token': 'password-invite-token' } },
    )
  })

  it('social buttons appear when feature flags are enabled', () => {
    mockDeploymentConfig.enableGoogleOAuth = true
    mockDeploymentConfig.enableGitHubOAuth = true
    mockDeploymentConfig.enableTwitterOAuth = true

    render(<AuthPanel />)

    expect(screen.getByText('Continue with Google')).toBeInTheDocument()
    expect(screen.getByText('Continue with GitHub')).toBeInTheDocument()
    expect(screen.getByText('Continue with X')).toBeInTheDocument()
  })

  it('returns X social sign-in with the twitter provider', async () => {
    mockDeploymentConfig.enableTwitterOAuth = true
    const { user } = render(<AuthPanel />)

    await user.click(screen.getByText('Continue with X'))

    expect(mockSignInSocial).toHaveBeenCalledWith(
      {
        provider: 'twitter',
        callbackURL: `${window.location.origin}/`,
      },
      {},
    )
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

  it('OIDC button appears and signs in with social', async () => {
    mockDeploymentConfig.oidcProviders = [{ id: 'oidc', name: 'Company SSO' }]
    mockSearch.redirect = '/groups/abc?invite=link-invite-token'

    const { user } = render(<AuthPanel />)

    expect(screen.getByText('Continue with Company SSO')).toBeInTheDocument()

    await user.click(screen.getByText('Continue with Company SSO'))

    expect(mockSignInSocial).toHaveBeenCalledWith(
      {
        provider: 'oidc',
        callbackURL: `${window.location.origin}/groups/abc?invite=link-invite-token`,
      },
      { headers: { 'X-Spliit-Invite-Token': 'link-invite-token' } },
    )
  })

  // ── Last used login method ──────────────────────────────────────

  it('shows a Last used badge on the matching social button', () => {
    mockDeploymentConfig.enableGoogleOAuth = true
    mockDeploymentConfig.enableGitHubOAuth = true
    mockGetLastUsedLoginMethod.mockReturnValue('google')

    render(<AuthPanel />)

    expect(
      screen.getByRole('button', { name: /Continue with Google/ }),
    ).toHaveTextContent('Last used')
    expect(
      screen.getByRole('button', { name: 'Continue with GitHub' }),
    ).not.toHaveTextContent('Last used')
  })

  it('defaults to the password tab when the last method was email', () => {
    mockGetLastUsedLoginMethod.mockReturnValue('email')

    render(<AuthPanel />)

    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /password/i })).toHaveTextContent(
      'Last used',
    )
  })

  it('shows a Last used badge on the magic-link tab', () => {
    mockGetLastUsedLoginMethod.mockReturnValue('magic-link')

    render(<AuthPanel />)

    expect(screen.getByRole('tab', { name: /magic link/i })).toHaveTextContent(
      'Last used',
    )
  })

  it('shows a Last used badge on the anonymous button', () => {
    mockGetLastUsedLoginMethod.mockReturnValue('anonymous')

    render(<AuthPanel />)

    expect(screen.getByRole('button', { name: /Anonymous/ })).toHaveTextContent(
      'Last used',
    )
  })

  it('shows no Last used badges without a stored method', () => {
    mockDeploymentConfig.enableGoogleOAuth = true

    render(<AuthPanel />)

    expect(screen.queryByText('Last used')).not.toBeInTheDocument()
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

  it('shows sign-up and the invited-email hint for an email invitation', () => {
    mockDeploymentConfig.signupMode = 'invite_only'
    mockDeploymentConfig.allowUninvitedSignup = false
    mockSearch.invitation = 'inv-1'
    mockSearch.email = 'invited@example.com'

    render(<AuthPanel />)

    expect(
      screen.getByText('Create your Spliit Cloud account'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Use the email address you were invited with.'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveValue('invited@example.com')
  })

  it('creates an anonymous account without collecting a display name', async () => {
    mockDeploymentConfig.enableAnonymousAuth = true
    mockSignInAnonymous.mockResolvedValue({ data: {}, error: null })
    const { user } = render(<AuthPanel redirectTo="/groups" />)

    await user.click(screen.getByRole('button', { name: 'Anonymous' }))

    expect(screen.getByText('Create a new account')).toBeInTheDocument()
    expect(screen.getByText('OR')).toBeInTheDocument()
    expect(
      screen.getByText(/you will need to save a permanent sign in link/i),
    ).toBeInTheDocument()
    const createButton = screen.getByRole('button', {
      name: 'Create anonymous account',
    })
    expect(createButton).toBeEnabled()
    expect(screen.queryByLabelText('Display name')).not.toBeInTheDocument()
    await user.click(createButton)

    expect(mockSignInAnonymous).toHaveBeenCalledWith({ fetchOptions: {} })
    expect(mockReplaceBrowserLocation).toHaveBeenCalledWith(
      '/auth/complete-profile?redirect=%2Fgroups',
    )
  })

  it('permits an invited anonymous account on an invite-only instance', async () => {
    mockDeploymentConfig.enableAnonymousAuth = true
    mockDeploymentConfig.signupMode = 'invite_only'
    mockDeploymentConfig.allowUninvitedSignup = false
    mockSearch.redirect = '/groups/grp-1?invite=invite-token-123456'
    mockSignInAnonymous.mockResolvedValue({ data: {}, error: null })
    const { user } = render(<AuthPanel />)

    await user.click(screen.getByRole('button', { name: 'Anonymous' }))
    await user.click(
      screen.getByRole('button', { name: 'Create anonymous account' }),
    )

    expect(mockSignInAnonymous).toHaveBeenCalledWith({
      fetchOptions: {
        headers: { 'X-Spliit-Invite-Token': 'invite-token-123456' },
      },
    })
    expect(mockReplaceBrowserLocation).toHaveBeenCalledWith(
      `/auth/complete-profile?redirect=${encodeURIComponent(mockSearch.redirect)}`,
    )
  })

  it('keeps anonymous creation hidden on invite-only instances without a link', async () => {
    mockDeploymentConfig.enableAnonymousAuth = true
    mockDeploymentConfig.signupMode = 'invite_only'
    mockDeploymentConfig.allowUninvitedSignup = true
    const { user } = render(<AuthPanel />)

    await user.click(screen.getByRole('button', { name: 'Anonymous' }))

    expect(
      screen.queryByRole('button', { name: 'Create anonymous account' }),
    ).not.toBeInTheDocument()
  })

  it('shows recovery-only anonymous access when signup is disabled', async () => {
    mockDeploymentConfig.enableAnonymousAuth = false

    const { user } = render(<AuthPanel />)

    await user.click(screen.getByRole('button', { name: 'Anonymous' }))

    expect(
      screen.getByText(/New anonymous accounts are not available here/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Sign in to anonymous account' }),
    ).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'Create anonymous account' }),
    ).not.toBeInTheDocument()
  })

  it('renders Anonymous as the final sign-in button', () => {
    mockDeploymentConfig.enableAnonymousAuth = true
    mockDeploymentConfig.enableTwitterOAuth = true
    mockDeploymentConfig.oidcProviders = [{ id: 'oidc', name: 'Company SSO' }]

    render(<AuthPanel />)

    const methods = screen
      .getAllByRole('button')
      .filter((button) =>
        ['Continue with X', 'Continue with Company SSO', 'Anonymous'].includes(
          button.textContent ?? '',
        ),
      )
    expect(methods.map((button) => button.textContent)).toEqual([
      'Continue with X',
      'Continue with Company SSO',
      'Anonymous',
    ])
    expect(methods.at(-1)).toHaveClass('w-full', 'border-border/80')
  })

  it('offers creation first and a separate sign-in-link form below it', async () => {
    mockDeploymentConfig.enableAnonymousAuth = true
    mockRecoverAnonymous.mockRejectedValue(new Error('stop after assertion'))
    const savedKey = `spliit_anonymous_v1_${'a'.repeat(43)}`
    const { user } = render(<AuthPanel />)

    await user.click(screen.getByRole('button', { name: 'Anonymous' }))
    expect(
      screen.getByRole('button', { name: 'Create anonymous account' }),
    ).toBeInTheDocument()

    await user.type(
      screen.getByLabelText('Sign in link'),
      `https://app.example/auth/recover#code=${savedKey}`,
    )
    await user.click(
      screen.getByRole('button', { name: 'Sign in to anonymous account' }),
    )

    expect(mockRecoverAnonymous).toHaveBeenCalledWith({ code: savedKey })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This sign in link is invalid.',
    )
    expect(mockSignInAnonymous).not.toHaveBeenCalled()
  })

  it('returns anonymous recovery to the pending invite destination', async () => {
    mockDeploymentConfig.enableAnonymousAuth = true
    mockSearch.redirect = '/groups/grp-1?invite=recovery-invite'
    mockRecoverAnonymous.mockResolvedValue({ success: true })
    const savedKey = `spliit_anonymous_v1_${'a'.repeat(43)}`
    const { user } = render(<AuthPanel />)

    await user.click(screen.getByRole('button', { name: 'Anonymous' }))
    await user.type(
      screen.getByLabelText('Sign in link'),
      `https://app.example/auth/recover#code=${savedKey}`,
    )
    await user.click(
      screen.getByRole('button', { name: 'Sign in to anonymous account' }),
    )

    expect(mockReplaceBrowserLocation).toHaveBeenCalledWith(
      '/groups/grp-1?invite=recovery-invite',
    )
  })

  it('rejects a malformed sign in link without submitting it', async () => {
    mockDeploymentConfig.enableAnonymousAuth = true
    const { user } = render(<AuthPanel />)

    await user.click(screen.getByRole('button', { name: 'Anonymous' }))
    await user.type(screen.getByLabelText('Sign in link'), 'not a sign in link')
    await user.click(
      screen.getByRole('button', { name: 'Sign in to anonymous account' }),
    )

    expect(mockRecoverAnonymous).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This sign in link is invalid.',
    )
  })

  it('disables social, email, and anonymous sign-in while keeping legal links when offline', () => {
    mockDeploymentConfig.enableGoogleOAuth = true
    mockDeploymentConfig.enableGitHubOAuth = true
    mockDeploymentConfig.enableTwitterOAuth = true
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })

    render(<AuthPanel />)

    expect(
      screen.getByRole('button', { name: 'Continue with Google' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Continue with GitHub' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Continue with X' }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Anonymous' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Send sign-in link' }),
    ).toBeDisabled()
    expect(screen.getByLabelText('Email')).toBeDisabled()
    expect(screen.getByRole('link', { name: 'Terms of use' })).toHaveAttribute(
      'href',
      '/terms',
    )
    expect(
      screen.getByRole('link', { name: 'Privacy notice' }),
    ).toHaveAttribute('href', '/privacy')
  })

  it('hides the email form and shows SSO notice when email auth is disabled', () => {
    mockDeploymentConfig.enableEmailAuth = false
    mockDeploymentConfig.oidcProviders = [{ id: 'oidc', name: 'SSO' }]

    render(<AuthPanel />)

    expect(
      screen.getByText(
        'Sign-in with email is disabled on this instance. Please use single sign-on.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Send sign-in link' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /SSO/i })).toBeInTheDocument()
  })

  it('keeps the invite-only notice when email auth is disabled', () => {
    mockDeploymentConfig.enableEmailAuth = false
    mockDeploymentConfig.oidcProviders = [{ id: 'oidc', name: 'SSO' }]
    mockDeploymentConfig.signupMode = 'invite_only'
    mockDeploymentConfig.allowUninvitedSignup = false

    render(<AuthPanel />)

    expect(
      screen.getByText(
        'Sign-in with email is disabled on this instance. Please use single sign-on.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'This instance is invite-only. Use an invitation link or ask someone to invite you to a group.',
      ),
    ).toBeInTheDocument()
  })
})
