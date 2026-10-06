import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CompleteProfilePage } from '@/app/auth/complete-profile'
import { useCurrentAccount } from '@/lib/use-current-account'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'

// ── Hoisted mocks ───────────────────────────────────────────────────────

const {
  acknowledgeMock,
  mockAddPasskey,
  mockRenamePasskey,
  mockMarkPasskeyLastUsed,
  mockDeploymentConfig,
  mockNavigate,
  mockNotifyPasskeyChanged,
  mockOnboardingStatus,
  mockPasskeySupported,
  mockRevokeRecovery,
  mockUpdateProfile,
  replacePendingMock,
  setupMock,
  statusMock,
} = vi.hoisted(() => ({
  acknowledgeMock: vi.fn(),
  mockAddPasskey: vi.fn(),
  mockRenamePasskey: vi.fn(),
  mockMarkPasskeyLastUsed: vi.fn(),
  mockDeploymentConfig: { enablePasskeyAuth: false },
  mockNavigate: vi.fn(),
  mockNotifyPasskeyChanged: vi.fn(),
  mockOnboardingStatus: {
    data: undefined as { anonymousOnboardingCompleted: boolean } | undefined,
    isPending: false,
    isFetching: false,
    refetch: vi.fn(),
  },
  mockPasskeySupported: { value: false },
  mockRevokeRecovery: vi.fn(),
  mockUpdateProfile: vi.fn(),
  replacePendingMock: vi.fn(),
  setupMock: vi.fn(),
  statusMock: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useSearch: () => ({ redirect: undefined }),
  }),
  useNavigate: () => mockNavigate,
  Navigate: ({
    to: _to,
    search: _search,
  }: {
    to: string
    search?: Record<string, unknown>
  }) => {
    // Render nothing in tests; the caller asserts that the form is absent.
    return null
  },
}))

vi.mock('@/lib/anonymous-recovery', () => ({
  acknowledgeAnonymousRecovery: acknowledgeMock,
  getAnonymousRecoveryStatus: statusMock,
  replacePendingAnonymousRecovery: replacePendingMock,
  revokeAnonymousRecovery: mockRevokeRecovery,
  setupAnonymousRecovery: setupMock,
}))

vi.mock('@/lib/use-current-account', () => ({
  useCurrentAccount: vi.fn(),
}))

vi.mock('@/lib/deployment-config', () => ({
  useDeploymentConfig: () => mockDeploymentConfig,
}))

vi.mock('@/lib/passkey', () => ({
  isPasskeySupported: () => mockPasskeySupported.value,
  addPasskey: mockAddPasskey,
  markPasskeyAsLastUsedLoginMethod: mockMarkPasskeyLastUsed,
  notifyPasskeyChanged: mockNotifyPasskeyChanged,
  renamePasskey: mockRenamePasskey,
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    account: {
      updateProfile: {
        useMutation: () => ({
          mutateAsync: mockUpdateProfile,
        }),
      },
      onboardingStatus: {
        // Mirror real TanStack semantics: a disabled query is pending with
        // no fetch in flight.
        useQuery: (_input: unknown, opts?: { enabled?: boolean }) =>
          opts?.enabled === false
            ? {
                data: undefined,
                isPending: true,
                isFetching: false,
                refetch: mockOnboardingStatus.refetch,
              }
            : mockOnboardingStatus,
      },
    },
  },
}))

// ── Helpers ─────────────────────────────────────────────────────────────

function mockAccount(
  overrides: Partial<{
    id: string
    name: string
    email: string
    emailVerified: boolean
    isAnonymous?: boolean | null
    anonymousOnboardingCompleted?: boolean | null
    image: string | null
    createdAt: Date
    updatedAt: Date
  }> = {},
) {
  const defaults = {
    id: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
    emailVerified: true,
    image: null as string | null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  return { ...defaults, ...overrides }
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('CompleteProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDeploymentConfig.enablePasskeyAuth = false
    mockPasskeySupported.value = false
    mockOnboardingStatus.data = undefined
    mockOnboardingStatus.isPending = false
    mockOnboardingStatus.isFetching = false
    mockAddPasskey.mockResolvedValue({ id: 'pk-1' })
    mockRenamePasskey.mockResolvedValue(undefined)
    mockNotifyPasskeyChanged.mockResolvedValue(undefined)
    mockRevokeRecovery.mockResolvedValue({ success: true })
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
    statusMock.mockResolvedValue({
      isAnonymous: true,
      hasRecoveryKey: false,
      acknowledged: false,
      onboardingCompleted: false,
      canResumeSetup: false,
      hasPasskey: false,
    })
    setupMock.mockResolvedValue({
      code: 'spliit_anonymous_v1_test-key',
      recoveryUrl:
        'https://app.example/auth/recover#code=spliit_anonymous_v1_test-key',
    })
    acknowledgeMock.mockResolvedValue({ success: true })
  })

  it('shows loading spinner while account is pending', () => {
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: null,
      isPending: true,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    const { container } = render(<CompleteProfilePage />)

    // Loader2 renders an SVG with class "lucide-loader2" and "animate-spin"
    const spinner = container.querySelector('.lucide-loader-circle')
    expect(spinner).toBeInTheDocument()
    expect(spinner?.getAttribute('class')).toContain('animate-spin')
  })

  it('redirects to / when no account (not signed in)', () => {
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<CompleteProfilePage />)

    // The form should not be rendered — Navigate was returned instead
    expect(screen.queryByText('Complete your profile')).not.toBeInTheDocument()
  })

  it('redirects to redirectTo when account already has name', () => {
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: mockAccount({ name: 'Alice' }),
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    const { container } = render(<CompleteProfilePage />)

    // The form should not be rendered — Navigate was returned instead.
    // A disabled status query must not hold the spinner either.
    expect(screen.queryByText('Complete your profile')).not.toBeInTheDocument()
    expect(
      container.querySelector('.lucide-loader-circle'),
    ).not.toBeInTheDocument()
  })

  it('shows form when account has no name', () => {
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: mockAccount({ name: '' }),
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<CompleteProfilePage />)

    expect(screen.getByText('Complete your profile')).toBeInTheDocument()
    expect(
      screen.getByText(
        "Tell us the name you'd like your groups to see. You can change it later.",
      ),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Display name')).toBeInTheDocument()
    expect(screen.getByText('Save and continue')).toBeInTheDocument()
  })

  it('hides an anonymous account synthetic email while naming the profile', () => {
    const email = 'guest-1@anonymous.placeholder.local'
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: mockAccount({
        name: email,
        email,
        isAnonymous: true,
        anonymousOnboardingCompleted: true,
      }),
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<CompleteProfilePage />)

    expect(screen.getByLabelText('Display name')).toBeInTheDocument()
    expect(screen.queryByText(email)).not.toBeInTheDocument()
  })

  it('shows error when name is empty', () => {
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: mockAccount({ name: '' }),
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    const { container } = render(<CompleteProfilePage />)

    // Submit the form directly (the button is disabled when name is empty)
    const form = container.querySelector('form') as HTMLFormElement
    fireEvent.submit(form)

    expect(screen.getByText('Enter a display name.')).toBeInTheDocument()
    // The alert role should be present
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a display name.')
  })

  it('shows error when name is too short (< 2 chars)', async () => {
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: mockAccount({ name: '' }),
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    const { user } = render(<CompleteProfilePage />)

    const nameInput = screen.getByLabelText('Display name')
    await user.type(nameInput, 'A')

    await user.click(screen.getByText('Save and continue'))

    expect(
      screen.getByText('Name must be at least 2 characters.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Name must be at least 2 characters.',
    )
  })

  it('calls updateProfile and waits for fresh state on submit', async () => {
    const mockRefetch = vi.fn().mockResolvedValue(undefined)
    mockUpdateProfile.mockResolvedValue(undefined)

    vi.mocked(useCurrentAccount).mockReturnValue({
      data: mockAccount({ name: '' }),
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: mockRefetch,
    })

    const { user } = render(<CompleteProfilePage />)

    const nameInput = screen.getByLabelText('Display name')
    await user.type(nameInput, 'Alice')

    await user.click(screen.getByText('Save and continue'))

    expect(mockUpdateProfile).toHaveBeenCalledWith({ name: 'Alice' })
    // After mutation success, the session is refetched so the re-rendered
    // account routes itself — no blind navigation: the mocked account still
    // needs a name, so the form stays put waiting for fresh state.
    expect(mockRefetch).toHaveBeenCalledWith({
      query: { disableCookieCache: true },
    })
    expect(screen.getByLabelText('Display name')).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('shows the safeguard step once the anonymous account has a name', async () => {
    mockDeploymentConfig.enablePasskeyAuth = true
    mockPasskeySupported.value = true
    const email = 'guest-1@anonymous.placeholder.local'
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: mockAccount({
        name: 'New Guest',
        email,
        anonymousOnboardingCompleted: false,
        isAnonymous: true,
      }),
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<CompleteProfilePage />)

    // Name-first: with the display name set, onboarding continues at the
    // safeguard choice instead of asking for the name again.
    expect(
      await screen.findByText('Choose your backup sign-in'),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Display name')).not.toBeInTheDocument()
  })

  it('keeps a named guest on the safeguard step while the server awaits it', async () => {
    // The reported escape: session predicate alone calls this account done
    // (real name, no embedded flag) and would redirect to the dashboard
    // into 412s. The authoritative status query keeps the safeguard up.
    mockOnboardingStatus.data = { anonymousOnboardingCompleted: false }
    const email = 'guest-1@anonymous.placeholder.local'
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: mockAccount({
        name: 'New Guest',
        email,
        isAnonymous: true,
      }),
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<CompleteProfilePage />)

    expect(
      await screen.findByRole('button', { name: 'Start using Spliit' }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Display name')).not.toBeInTheDocument()
    expect(setupMock).toHaveBeenCalled()
  })

  it('redirects a named guest the server reports complete', async () => {
    mockOnboardingStatus.data = { anonymousOnboardingCompleted: true }
    const email = 'guest-1@anonymous.placeholder.local'
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: mockAccount({
        name: 'New Guest',
        email,
        isAnonymous: true,
      }),
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<CompleteProfilePage />)

    // Navigate renders null in tests: neither step may appear.
    await waitFor(() =>
      expect(screen.queryByLabelText('Display name')).not.toBeInTheDocument(),
    )
    expect(
      screen.queryByText('Choose your backup sign-in'),
    ).not.toBeInTheDocument()
  })

  it('waits for the authoritative status before redirecting out', async () => {
    mockOnboardingStatus.isPending = true
    mockOnboardingStatus.isFetching = true
    const email = 'guest-1@anonymous.placeholder.local'
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: mockAccount({
        name: 'New Guest',
        email,
        isAnonymous: true,
      }),
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    const { container } = render(<CompleteProfilePage />)

    // A named session alone cannot prove completion: hold the spinner
    // instead of redirecting on the fallback.
    expect(container.querySelector('.lucide-loader-circle')).toBeInTheDocument()
    expect(screen.queryByLabelText('Display name')).not.toBeInTheDocument()
  })

  it('asks an anonymous account for its display name before the safeguard', async () => {
    const email = 'guest-1@anonymous.placeholder.local'
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: mockAccount({
        name: email,
        email,
        isAnonymous: true,
      }),
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<CompleteProfilePage />)

    // Name-first: the display name form renders before the sign-in link
    // setup, so a passkey registered next already carries the real name.
    expect(await screen.findByLabelText('Display name')).toBeInTheDocument()
    expect(screen.queryByText('Save your sign in link')).not.toBeInTheDocument()
    expect(setupMock).not.toHaveBeenCalled()
  })

  it('skips recovery setup when the anonymous account already finished it', async () => {
    statusMock.mockResolvedValue({
      isAnonymous: true,
      hasRecoveryKey: true,
      acknowledged: true,
      onboardingCompleted: true,
      canResumeSetup: false,
      hasPasskey: false,
    })
    const email = 'guest-1@anonymous.placeholder.local'
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: mockAccount({
        name: email,
        email,
        isAnonymous: true,
      }),
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<CompleteProfilePage />)

    expect(await screen.findByLabelText('Display name')).toBeInTheDocument()
    expect(screen.queryByText('Save your sign in link')).not.toBeInTheDocument()
    expect(setupMock).not.toHaveBeenCalled()
  })

  it('skips recovery setup when a passkey is registered instead', async () => {
    // Passkey is the alternative safeguard chosen at signup: no link setup,
    // straight to naming. The recovery link is not created as a side effect.
    statusMock.mockResolvedValue({
      isAnonymous: true,
      hasRecoveryKey: false,
      acknowledged: false,
      onboardingCompleted: false,
      canResumeSetup: false,
      hasPasskey: true,
    })
    const email = 'guest-1@anonymous.placeholder.local'
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: mockAccount({
        name: email,
        email,
        isAnonymous: true,
      }),
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<CompleteProfilePage />)

    expect(await screen.findByLabelText('Display name')).toBeInTheDocument()
    expect(screen.queryByText('Save your sign in link')).not.toBeInTheDocument()
    expect(setupMock).not.toHaveBeenCalled()
  })

  it('offers link or passkey when both safeguards are available', async () => {
    mockDeploymentConfig.enablePasskeyAuth = true
    mockPasskeySupported.value = true
    const email = 'guest-1@anonymous.placeholder.local'
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: mockAccount({
        name: 'New Guest',
        email,
        anonymousOnboardingCompleted: false,
        isAnonymous: true,
      }),
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<CompleteProfilePage />)

    // Same choice as the signup dialog: radio cards, link pre-selected with
    // its setup shown below the group.
    expect(
      await screen.findByText('Choose your backup sign-in'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: /Save a recovery link/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: /Use a passkey instead/ }),
    ).toBeInTheDocument()
    // The card header owns the title; the pre-selected link setup shows the
    // key panel instead.
    expect(screen.queryByText('Save your sign in link')).not.toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: 'Start using Spliit' }),
    ).toBeInTheDocument()
    expect(setupMock).toHaveBeenCalled()
  })

  it('saves a recovery link from the complete-profile choice', async () => {
    mockDeploymentConfig.enablePasskeyAuth = true
    mockPasskeySupported.value = true
    const mockRefetch = vi.fn().mockResolvedValue(undefined)
    const email = 'guest-1@anonymous.placeholder.local'
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: mockAccount({
        name: 'New Guest',
        email,
        anonymousOnboardingCompleted: false,
        isAnonymous: true,
      }),
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: mockRefetch,
    })

    const { user } = render(<CompleteProfilePage />)

    // Link pre-selected: its setup shows below the group, no extra click.
    // Embedded link setup hides the duplicate heading; the key panel shows.
    expect(
      await screen.findByRole('button', { name: 'Start using Spliit' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Save your sign in link')).not.toBeInTheDocument()
    expect(setupMock).toHaveBeenCalled()

    await user.click(
      screen.getByRole('checkbox', {
        name: 'I copied and safely stored my sign in link.',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Start using Spliit' }))

    await waitFor(() => expect(acknowledgeMock).toHaveBeenCalled())
    // Named and safeguard-acknowledged: onboarding is done, the page leaves.
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Start using Spliit' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('switches between link and passkey choice cards', async () => {
    mockDeploymentConfig.enablePasskeyAuth = true
    mockPasskeySupported.value = true
    const email = 'guest-1@anonymous.placeholder.local'
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: mockAccount({
        name: 'New Guest',
        email,
        anonymousOnboardingCompleted: false,
        isAnonymous: true,
      }),
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    const { user } = render(<CompleteProfilePage />)

    expect(
      await screen.findByRole('button', { name: 'Start using Spliit' }),
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('radio', { name: /Use a passkey instead/ }),
    )

    expect(
      await screen.findByRole('button', { name: 'Add a passkey' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Start using Spliit' }),
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('radio', { name: /Save a recovery link/ }),
    )

    expect(
      await screen.findByRole('button', { name: 'Start using Spliit' }),
    ).toBeInTheDocument()
  })

  it('adds a passkey from the complete-profile choice', async () => {
    mockDeploymentConfig.enablePasskeyAuth = true
    mockPasskeySupported.value = true
    const mockRefetch = vi.fn().mockResolvedValue(undefined)
    const email = 'guest-1@anonymous.placeholder.local'
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: mockAccount({
        name: 'New Guest',
        email,
        anonymousOnboardingCompleted: false,
        isAnonymous: true,
      }),
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: mockRefetch,
    })

    const { user } = render(<CompleteProfilePage />)

    await user.click(
      await screen.findByRole('radio', { name: /Use a passkey instead/ }),
    )
    await user.click(screen.getByRole('button', { name: 'Add a passkey' }))

    // The ceremony always carries the display name; no label was typed, so
    // no rename follows.
    expect(mockAddPasskey).toHaveBeenCalledWith('New Guest')
    expect(mockRenamePasskey).not.toHaveBeenCalled()
    expect(mockNotifyPasskeyChanged).toHaveBeenCalled()
    // Passkey-onboarded: the login screen hints at the passkey next time.
    expect(mockMarkPasskeyLastUsed).toHaveBeenCalled()
    // The never-acknowledged setup link is cleaned up.
    expect(mockRevokeRecovery).toHaveBeenCalledWith({ onlyPending: true })
    // Named and safeguard-complete: onboarding is done, the page leaves.
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Add a passkey' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('shows the offline state when the name step cannot run offline', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    const email = 'guest-1@anonymous.placeholder.local'
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: mockAccount({
        name: email,
        email,
        isAnonymous: true,
      }),
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<CompleteProfilePage />)

    expect(screen.getByTestId('offline-empty-state')).toBeInTheDocument()
    expect(screen.queryByLabelText('Display name')).not.toBeInTheDocument()
    expect(statusMock).not.toHaveBeenCalled()
  })
})
