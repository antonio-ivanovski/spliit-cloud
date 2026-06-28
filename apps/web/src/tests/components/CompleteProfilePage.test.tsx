import { fireEvent, render, screen } from '@/test/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CompleteProfilePage } from '@/app/auth/complete-profile'
import { useCurrentAccount } from '@/lib/use-current-account'

// ── Hoisted mocks ───────────────────────────────────────────────────────

const { mockUpdateProfile, mockNavigate } = vi.hoisted(() => ({
  mockUpdateProfile: vi.fn(),
  mockNavigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useSearch: () => ({ redirect: undefined }),
  }),
  useNavigate: () => mockNavigate,
  Navigate: ({
    to,
    search,
  }: {
    to: string
    search?: Record<string, unknown>
  }) => {
    // Render nothing in tests; the caller asserts that the form is absent.
    return null
  },
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
})
