import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthPanel } from '@/components/auth/auth-panel'
import { resetConnectivityForTests } from '@/lib/connectivity'
import { fireEvent, render, screen } from '@/test/test-utils'

// ── Hoisted mocks ───────────────────────────────────────────────────────

const {
  mockSignInEmail,
  mockSignUpEmail,
  mockSignInMagicLink,
  mockSignInSocial,
  mockSignInAnonymous,
  mockSignInPasskey,
  mockAddPasskey,
  mockRenamePasskey,
  mockMarkPasskeyLastUsed,
  mockNotifyPasskeyChanged,
  mockRecoveryStatus,
  mockSetupRecovery,
  mockAcknowledgeRecovery,
  mockRevokeRecovery,
  mockRecoverAnonymous,
  mockGetSession,
  mockNavigate,
  mockDeploymentConfig,
  mockMascotReact,
  mockSearch,
  mockGetLastUsedLoginMethod,
  mockReplaceBrowserLocation,
  mockPasskeySupported,
  mockUpdateProfile,
} = vi.hoisted(() => ({
  mockSignInEmail: vi.fn(),
  mockSignUpEmail: vi.fn(),
  mockSignInMagicLink: vi.fn(),
  mockSignInSocial: vi.fn(),
  mockSignInAnonymous: vi.fn(),
  mockSignInPasskey: vi.fn(),
  mockAddPasskey: vi.fn(),
  mockRenamePasskey: vi.fn(),
  mockMarkPasskeyLastUsed: vi.fn(),
  mockNotifyPasskeyChanged: vi.fn(),
  mockRecoveryStatus: vi.fn(),
  mockSetupRecovery: vi.fn(),
  mockAcknowledgeRecovery: vi.fn(),
  mockRevokeRecovery: vi.fn(),
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
    enablePasskeyAuth: true,
    emailDeliveryEnabled: true,
    maxExpenseDocumentSize: 2 * 1024 * 1024,
  },
  mockMascotReact: vi.fn(),
  mockGetLastUsedLoginMethod: vi.fn(),
  mockReplaceBrowserLocation: vi.fn(),
  mockPasskeySupported: { value: false },
  mockUpdateProfile: vi.fn(),
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
      passkey: mockSignInPasskey,
    },
    signUp: {
      email: mockSignUpEmail,
    },
    passkey: {
      addPasskey: mockAddPasskey,
    },
    getSession: mockGetSession,
    getLastUsedLoginMethod: mockGetLastUsedLoginMethod,
  },
}))

vi.mock('@/lib/passkey', () => ({
  isPasskeySupported: () => mockPasskeySupported.value,
  addPasskey: mockAddPasskey,
  markPasskeyAsLastUsedLoginMethod: mockMarkPasskeyLastUsed,
  notifyPasskeyChanged: mockNotifyPasskeyChanged,
  renamePasskey: mockRenamePasskey,
}))

vi.mock('@/lib/deployment-config', () => ({
  useDeploymentConfig: () => mockDeploymentConfig,
}))

vi.mock('@/lib/browser-navigation', () => ({
  replaceBrowserLocation: mockReplaceBrowserLocation,
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    account: {
      updateProfile: {
        useMutation: () => ({
          mutateAsync: mockUpdateProfile,
        }),
      },
    },
  },
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
  getAnonymousRecoveryStatus: mockRecoveryStatus,
  setupAnonymousRecovery: mockSetupRecovery,
  acknowledgeAnonymousRecovery: mockAcknowledgeRecovery,
  revokeAnonymousRecovery: mockRevokeRecovery,
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
    mockDeploymentConfig.enablePasskeyAuth = true
    mockDeploymentConfig.emailDeliveryEnabled = true
    mockSearch.redirect = undefined
    mockSearch.mode = undefined
    mockSearch.email = undefined
    mockSearch.invitation = undefined
    mockPasskeySupported.value = false
    mockNotifyPasskeyChanged.mockResolvedValue(undefined)
    mockRenamePasskey.mockResolvedValue(undefined)
    mockRecoveryStatus.mockResolvedValue({
      isAnonymous: true,
      hasRecoveryKey: false,
      acknowledged: false,
      onboardingCompleted: false,
      canResumeSetup: false,
    })
    mockSetupRecovery.mockResolvedValue({
      code: 'code-1',
      recoveryUrl: 'https://app.example/auth/recover#code=code-1',
    })
    mockAcknowledgeRecovery.mockResolvedValue(undefined)
    mockRevokeRecovery.mockResolvedValue({ success: true })
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
    expect(
      screen.getByText('Already have an anonymous account?'),
    ).toBeInTheDocument()
    expect(screen.queryByText('OR')).not.toBeInTheDocument()
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

  // ── Passkey sign-in ───────────────────────────────────────────────────

  it('offers passkey sign-in when enabled', () => {
    mockDeploymentConfig.enablePasskeyAuth = true

    render(<AuthPanel />)

    expect(
      screen.getByRole('button', { name: /sign in with passkey/i }),
    ).toBeInTheDocument()
  })

  it('hides passkey sign-in when disabled', () => {
    mockDeploymentConfig.enablePasskeyAuth = false

    render(<AuthPanel />)

    expect(
      screen.queryByRole('button', { name: /sign in with passkey/i }),
    ).not.toBeInTheDocument()
  })

  it('signs in with a passkey and follows the redirect', async () => {
    mockDeploymentConfig.enablePasskeyAuth = true
    mockSignInPasskey.mockResolvedValue({ data: {}, error: null })
    mockGetSession.mockResolvedValue({ data: null })
    mockNavigate.mockReturnValue(undefined)
    const { user } = render(<AuthPanel redirectTo="/groups" />)

    await user.click(
      screen.getByRole('button', { name: /sign in with passkey/i }),
    )

    expect(mockSignInPasskey).toHaveBeenCalled()
  })

  it('shows the last-used badge on the passkey method', () => {
    mockDeploymentConfig.enablePasskeyAuth = true
    mockGetLastUsedLoginMethod.mockReturnValue('passkey')

    render(<AuthPanel />)

    const button = screen.getByRole('button', {
      name: /sign in with passkey/i,
    })
    expect(button).toHaveTextContent('Last used')
  })

  // ── Anonymous signup safeguard choice ───────────────────────────────

  // Name-first: after anonymous creation the dialog collects the display
  // name before offering the safeguard choice, so a passkey registered
  // there already carries the real name.
  async function createAnonymousAccount(
    user: ReturnType<typeof render>['user'],
  ) {
    await user.click(screen.getByRole('button', { name: 'Anonymous' }))
    await user.click(
      screen.getByRole('button', { name: 'Create anonymous account' }),
    )
    expect(await screen.findByText('Choose a display name')).toBeInTheDocument()
    expect(
      screen.queryByText('Choose your backup sign-in'),
    ).not.toBeInTheDocument()
  }

  async function saveDialogDisplayName(
    user: ReturnType<typeof render>['user'],
    name = 'New Guest',
  ) {
    await user.type(screen.getByLabelText('Display name'), name)
    await user.click(screen.getByRole('button', { name: 'Save and continue' }))
    expect(mockUpdateProfile).toHaveBeenCalledWith({ name })
    expect(mockGetSession).toHaveBeenCalledWith({
      query: { disableCookieCache: true },
    })
    expect(
      await screen.findByText('Choose your backup sign-in'),
    ).toBeInTheDocument()
  }

  it('collects the display name before the choice after anonymous creation', async () => {
    mockDeploymentConfig.enableAnonymousAuth = true
    mockDeploymentConfig.enablePasskeyAuth = true
    mockPasskeySupported.value = true
    mockSignInAnonymous.mockResolvedValue({ data: {}, error: null })
    mockUpdateProfile.mockResolvedValue({ account: { name: 'New Guest' } })
    const { user } = render(<AuthPanel redirectTo="/groups" />)

    await createAnonymousAccount(user)
    await saveDialogDisplayName(user)
    expect(mockReplaceBrowserLocation).not.toHaveBeenCalled()
  })

  it('rejects a too-short display name in the dialog', async () => {
    mockDeploymentConfig.enableAnonymousAuth = true
    mockDeploymentConfig.enablePasskeyAuth = true
    mockPasskeySupported.value = true
    mockSignInAnonymous.mockResolvedValue({ data: {}, error: null })
    const { user } = render(<AuthPanel redirectTo="/groups" />)

    await createAnonymousAccount(user)
    await user.type(screen.getByLabelText('Display name'), 'A')
    await user.click(screen.getByRole('button', { name: 'Save and continue' }))

    expect(
      await screen.findByText('Name must be at least 2 characters.'),
    ).toBeInTheDocument()
    expect(mockUpdateProfile).not.toHaveBeenCalled()
    expect(
      screen.queryByText('Choose your backup sign-in'),
    ).not.toBeInTheDocument()
  })

  it('shows the offline state on the dialog name step when offline', async () => {
    mockDeploymentConfig.enableAnonymousAuth = true
    mockDeploymentConfig.enablePasskeyAuth = true
    mockPasskeySupported.value = true
    mockSignInAnonymous.mockResolvedValue({ data: {}, error: null })
    const { user } = render(<AuthPanel redirectTo="/groups" />)

    await createAnonymousAccount(user)

    // Connectivity drops mid-flow: the name form (a network mutation)
    // yields to the offline state instead of a dead form…
    fireEvent(window, new Event('offline'))
    expect(await screen.findByTestId('offline-empty-state')).toBeInTheDocument()
    expect(screen.queryByLabelText('Display name')).not.toBeInTheDocument()
    expect(mockUpdateProfile).not.toHaveBeenCalled()

    // …and the form returns with connectivity.
    fireEvent(window, new Event('online'))
    expect(await screen.findByLabelText('Display name')).toBeInTheDocument()
  })

  it('stays on the name step when saving the display name fails', async () => {
    mockDeploymentConfig.enableAnonymousAuth = true
    mockDeploymentConfig.enablePasskeyAuth = true
    mockPasskeySupported.value = true
    mockSignInAnonymous.mockResolvedValue({ data: {}, error: null })
    mockUpdateProfile.mockRejectedValue(new Error('offline'))
    const { user } = render(<AuthPanel redirectTo="/groups" />)

    await createAnonymousAccount(user)
    await user.type(screen.getByLabelText('Display name'), 'New Guest')
    await user.click(screen.getByRole('button', { name: 'Save and continue' }))

    expect(
      await screen.findByText(
        'Could not save the display name. Please try again.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Choose your backup sign-in'),
    ).not.toBeInTheDocument()
  })

  it('offers link-first choice after anonymous creation when supported', async () => {
    mockDeploymentConfig.enableAnonymousAuth = true
    mockDeploymentConfig.enablePasskeyAuth = true
    mockPasskeySupported.value = true
    mockSignInAnonymous.mockResolvedValue({ data: {}, error: null })
    mockUpdateProfile.mockResolvedValue({ account: { name: 'New Guest' } })
    mockAddPasskey.mockResolvedValue({ id: 'pk-1' })
    const { user } = render(<AuthPanel redirectTo="/groups" />)

    await createAnonymousAccount(user)
    await saveDialogDisplayName(user)
    expect(
      screen.getByRole('radio', { name: /Save a recovery link/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: /Use a passkey instead/ }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Skip for now' }),
    ).not.toBeInTheDocument()
    expect(mockReplaceBrowserLocation).not.toHaveBeenCalled()

    await user.click(
      screen.getByRole('radio', { name: /Use a passkey instead/ }),
    )
    // Optional credential name travels with the registration.
    await user.type(
      screen.getByLabelText('Name this passkey (optional)'),
      'My iPhone',
    )
    await user.click(screen.getByRole('button', { name: 'Add a passkey' }))

    // The ceremony always carries the display name; the typed label only
    // renames the Spliit-side nickname afterwards.
    expect(mockAddPasskey).toHaveBeenCalledWith('New Guest')
    expect(mockRenamePasskey).toHaveBeenCalledWith('pk-1', 'My iPhone')
    expect(mockNotifyPasskeyChanged).toHaveBeenCalled()
    // Passkey-onboarded: the login screen hints at the passkey next time.
    expect(mockMarkPasskeyLastUsed).toHaveBeenCalled()
    // The never-acknowledged setup link is cleaned up; a saved backup
    // would be left untouched (see the pending-only unit test).
    expect(mockRevokeRecovery).toHaveBeenCalledWith({ onlyPending: true })
    expect(mockReplaceBrowserLocation).toHaveBeenCalledWith(
      '/auth/complete-profile?redirect=%2Fgroups',
    )
  })

  it('skips the rename when the passkey label is left empty', async () => {
    mockDeploymentConfig.enableAnonymousAuth = true
    mockDeploymentConfig.enablePasskeyAuth = true
    mockPasskeySupported.value = true
    mockSignInAnonymous.mockResolvedValue({ data: {}, error: null })
    mockUpdateProfile.mockResolvedValue({ account: { name: 'New Guest' } })
    mockAddPasskey.mockResolvedValue({ id: 'pk-1' })
    const { user } = render(<AuthPanel redirectTo="/groups" />)

    await createAnonymousAccount(user)
    await saveDialogDisplayName(user)

    await user.click(
      screen.getByRole('radio', { name: /Use a passkey instead/ }),
    )
    await user.click(screen.getByRole('button', { name: 'Add a passkey' }))

    // Ceremony still carries the display name; nothing to rename.
    expect(mockAddPasskey).toHaveBeenCalledWith('New Guest')
    expect(mockRenamePasskey).not.toHaveBeenCalled()
    expect(mockReplaceBrowserLocation).toHaveBeenCalledWith(
      '/auth/complete-profile?redirect=%2Fgroups',
    )
  })

  it('saves a recovery link from the choice step', async () => {
    mockDeploymentConfig.enableAnonymousAuth = true
    mockDeploymentConfig.enablePasskeyAuth = true
    mockPasskeySupported.value = true
    mockSignInAnonymous.mockResolvedValue({ data: {}, error: null })
    mockUpdateProfile.mockResolvedValue({ account: { name: 'New Guest' } })
    const { user } = render(<AuthPanel redirectTo="/groups" />)

    await createAnonymousAccount(user)
    await saveDialogDisplayName(user)

    // Link pre-selected: its setup shows below the group, no extra click.
    // The dialog header owns the title, so the onboarding hides its
    // duplicate heading and shows the key panel.
    expect(
      await screen.findByRole('button', { name: 'Start using Spliit' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Save your sign in link')).not.toBeInTheDocument()
    expect(mockSetupRecovery).toHaveBeenCalled()

    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Start using Spliit' }))

    expect(mockAcknowledgeRecovery).toHaveBeenCalled()
    expect(mockAddPasskey).not.toHaveBeenCalled()
    expect(mockReplaceBrowserLocation).toHaveBeenCalledWith(
      '/auth/complete-profile?redirect=%2Fgroups',
    )
  })

  it('switches between link and passkey choice cards', async () => {
    mockDeploymentConfig.enableAnonymousAuth = true
    mockDeploymentConfig.enablePasskeyAuth = true
    mockPasskeySupported.value = true
    mockSignInAnonymous.mockResolvedValue({ data: {}, error: null })
    mockUpdateProfile.mockResolvedValue({ account: { name: 'New Guest' } })
    const { user } = render(<AuthPanel redirectTo="/groups" />)

    await createAnonymousAccount(user)
    await saveDialogDisplayName(user)
    expect(
      await screen.findByRole('button', { name: 'Start using Spliit' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Add a passkey' }),
    ).not.toBeInTheDocument()
    // Compact cards: the selected setup renders below the radio group,
    // not inside a card.
    expect(
      screen.getByRole('radiogroup', { name: 'Choose your backup sign-in' })
        .nextElementSibling,
    ).toHaveTextContent('Start using Spliit')

    await user.click(
      screen.getByRole('radio', { name: /Use a passkey instead/ }),
    )

    expect(
      await screen.findByRole('button', { name: 'Add a passkey' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Start using Spliit' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('radiogroup', { name: 'Choose your backup sign-in' })
        .nextElementSibling,
    ).toHaveTextContent('Add a passkey')

    await user.click(
      screen.getByRole('radio', { name: /Save a recovery link/ }),
    )

    expect(
      await screen.findByRole('button', { name: 'Start using Spliit' }),
    ).toBeInTheDocument()
    expect(mockReplaceBrowserLocation).not.toHaveBeenCalled()
  })

  it('stays on the choice step when adding the passkey fails', async () => {
    mockDeploymentConfig.enableAnonymousAuth = true
    mockDeploymentConfig.enablePasskeyAuth = true
    mockPasskeySupported.value = true
    mockSignInAnonymous.mockResolvedValue({ data: {}, error: null })
    mockUpdateProfile.mockResolvedValue({ account: { name: 'New Guest' } })
    mockAddPasskey.mockRejectedValue(new Error('PASSKEY_ADD_FAILED'))
    const { user } = render(<AuthPanel redirectTo="/groups" />)

    await createAnonymousAccount(user)
    await saveDialogDisplayName(user)

    await user.click(
      screen.getByRole('radio', { name: /Use a passkey instead/ }),
    )
    await user.click(screen.getByRole('button', { name: 'Add a passkey' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not add the passkey.',
    )
    expect(mockReplaceBrowserLocation).not.toHaveBeenCalled()
  })

  // ── Anonymous dialog already-have section ─────────────────────────

  it('groups existing-account actions under a heading without an OR divider', async () => {
    mockDeploymentConfig.enableAnonymousAuth = true
    mockDeploymentConfig.enablePasskeyAuth = true
    mockPasskeySupported.value = true
    const { user } = render(<AuthPanel redirectTo="/groups" />)

    await user.click(screen.getByRole('button', { name: 'Anonymous' }))

    expect(
      screen.getByText('Already have an anonymous account?'),
    ).toBeInTheDocument()
    expect(screen.queryByText('OR')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Sign in to anonymous account' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Sign in with passkey' }),
    ).toBeInTheDocument()
  })

  it('signs an existing anonymous account in with a passkey', async () => {
    mockDeploymentConfig.enableAnonymousAuth = true
    mockDeploymentConfig.enablePasskeyAuth = true
    mockPasskeySupported.value = true
    mockSignInPasskey.mockResolvedValue({ data: {}, error: null })
    mockGetSession.mockResolvedValue({
      data: { user: { name: 'Guest', email: 'guest@example.com' } },
    })
    const { user } = render(<AuthPanel redirectTo="/groups" />)

    await user.click(screen.getByRole('button', { name: 'Anonymous' }))
    await user.click(
      screen.getByRole('button', { name: 'Sign in with passkey' }),
    )

    expect(mockSignInPasskey).toHaveBeenCalled()
    expect(mockReplaceBrowserLocation).toHaveBeenCalledWith('/groups')
  })

  it('sends a nameless passkey account through complete-profile', async () => {
    mockDeploymentConfig.enableAnonymousAuth = true
    mockDeploymentConfig.enablePasskeyAuth = true
    mockPasskeySupported.value = true
    mockSignInPasskey.mockResolvedValue({ data: {}, error: null })
    mockGetSession.mockResolvedValue({
      data: { user: { name: '', email: '' } },
    })
    const { user } = render(<AuthPanel redirectTo="/groups" />)

    await user.click(screen.getByRole('button', { name: 'Anonymous' }))
    await user.click(
      screen.getByRole('button', { name: 'Sign in with passkey' }),
    )

    expect(mockReplaceBrowserLocation).toHaveBeenCalledWith(
      '/auth/complete-profile?redirect=%2Fgroups',
    )
  })

  it('stays silent when the passkey prompt is dismissed', async () => {
    mockDeploymentConfig.enableAnonymousAuth = true
    mockDeploymentConfig.enablePasskeyAuth = true
    mockPasskeySupported.value = true
    mockSignInPasskey.mockResolvedValue({
      data: null,
      error: { code: 'USER_CANCELLED', message: 'The prompt was dismissed' },
    })
    const { user } = render(<AuthPanel redirectTo="/groups" />)

    await user.click(screen.getByRole('button', { name: 'Anonymous' }))
    await user.click(
      screen.getByRole('button', { name: 'Sign in with passkey' }),
    )

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(mockReplaceBrowserLocation).not.toHaveBeenCalled()
  })

  it('shows an error when passkey sign-in fails', async () => {
    mockDeploymentConfig.enableAnonymousAuth = true
    mockDeploymentConfig.enablePasskeyAuth = true
    mockPasskeySupported.value = true
    mockSignInPasskey.mockResolvedValue({
      data: null,
      error: { code: 'AUTH_FAILED', message: 'nope' },
    })
    const { user } = render(<AuthPanel redirectTo="/groups" />)

    await user.click(screen.getByRole('button', { name: 'Anonymous' }))
    await user.click(
      screen.getByRole('button', { name: 'Sign in with passkey' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not sign in with this passkey.',
    )
    expect(mockReplaceBrowserLocation).not.toHaveBeenCalled()
  })

  it('hides passkey sign-in in the dialog when unsupported', async () => {
    mockDeploymentConfig.enableAnonymousAuth = true
    mockDeploymentConfig.enablePasskeyAuth = true
    mockPasskeySupported.value = false
    const { user } = render(<AuthPanel redirectTo="/groups" />)

    await user.click(screen.getByRole('button', { name: 'Anonymous' }))

    expect(
      screen.getByText('Already have an anonymous account?'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Sign in with passkey' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Sign in to anonymous account' }),
    ).toBeInTheDocument()
  })
})
