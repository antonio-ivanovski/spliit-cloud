import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CompleteProfilePage } from '@/app/auth/complete-profile'
import { useCurrentAccount } from '@/lib/use-current-account'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'

// ── Hoisted mocks ───────────────────────────────────────────────────────

const {
  acknowledgeMock,
  mockNavigate,
  mockUpdateProfile,
  replacePendingMock,
  setupMock,
  statusMock,
} = vi.hoisted(() => ({
  acknowledgeMock: vi.fn(),
  mockNavigate: vi.fn(),
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
  setupAnonymousRecovery: setupMock,
}))

vi.mock('@/lib/use-current-account', () => ({
  useCurrentAccount: vi.fn(),
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

    render(<CompleteProfilePage />)

    // The form should not be rendered — Navigate was returned instead
    expect(screen.queryByText('Complete your profile')).not.toBeInTheDocument()
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

  it('calls updateProfile and navigates on submit', async () => {
    const mockRefetch = vi.fn().mockResolvedValue(undefined)
    mockUpdateProfile.mockResolvedValue(undefined)
    mockNavigate.mockResolvedValue(undefined)

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
    // After mutation success, the session is refetched and navigate is called
    expect(mockRefetch).toHaveBeenCalledWith({
      query: { disableCookieCache: true },
    })
    expect(mockNavigate).toHaveBeenCalledWith({
      href: '/',
      replace: true,
    })
  })

  it('asks an anonymous account to save its sign in link before naming', async () => {
    const mockRefetch = vi.fn().mockResolvedValue(undefined)
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
      refetch: mockRefetch,
    })

    const { user } = render(<CompleteProfilePage />)

    expect(
      await screen.findByText('Save your sign in link'),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Display name')).not.toBeInTheDocument()
    expect(
      screen.getByDisplayValue(
        'https://app.example/auth/recover#code=spliit_anonymous_v1_test-key',
      ),
    ).toBeInTheDocument()

    const start = screen.getByRole('button', { name: 'Start using Spliit' })
    expect(start).toBeDisabled()
    await user.click(
      screen.getByRole('checkbox', {
        name: 'I copied and safely stored my sign in link.',
      }),
    )
    await user.click(start)

    await waitFor(() =>
      expect(acknowledgeMock).toHaveBeenCalledWith({
        confirmedCopied: true,
        code: 'spliit_anonymous_v1_test-key',
      }),
    )
    expect(mockRefetch).toHaveBeenCalledWith({
      query: { disableCookieCache: true },
    })
    expect(await screen.findByLabelText('Display name')).toBeInTheDocument()
  })

  it('skips recovery setup when the anonymous account already finished it', async () => {
    statusMock.mockResolvedValue({
      isAnonymous: true,
      hasRecoveryKey: true,
      acknowledged: true,
      onboardingCompleted: true,
      canResumeSetup: false,
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

  it('does not enter the app when recovery setup cannot run offline', () => {
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
