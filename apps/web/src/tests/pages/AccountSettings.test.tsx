import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AccountSettingsPage } from '@/app/account/settings'
import { render, screen, waitFor } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  useCurrentAccount: vi.fn(),
  updateProfile: vi.fn(),
  invalidateAccount: vi.fn(),
  invalidateGroups: vi.fn(),
  invalidateInvitations: vi.fn(),
  refetchAccount: vi.fn(),
  toast: vi.fn(),
  useRouterNavigate: vi.fn(),
}))

vi.mock('@/lib/use-current-account', () => ({
  useCurrentAccount: mocks.useCurrentAccount,
}))

vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/lib/upload', () => ({
  prepareProfileImage: vi.fn(),
}))

vi.mock('@/app/account/account-preferences', () => ({
  AccountPreferences: () => (
    <section data-testid="app-preferences-mock">
      <h2>App preferences</h2>
    </section>
  ),
}))

vi.mock('@/app/account/ai-preferences', () => ({
  AccountAiPreferences: () => (
    <section data-testid="ai-preferences-mock">
      <h2>AI features</h2>
    </section>
  ),
}))

vi.mock('@/app/account/notifications-preferences', () => ({
  NotificationsPreferences: () => (
    <section data-testid="notifications-mock">
      <h2>Notifications</h2>
    </section>
  ),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      account: { invalidate: mocks.invalidateAccount },
      groups: { invalidate: mocks.invalidateGroups },
      invitations: { invalidate: mocks.invalidateInvitations },
    }),
    account: {
      updateProfile: {
        useMutation: () => ({ mutateAsync: mocks.updateProfile }),
      },
      removeProfileImage: {
        useMutation: () => ({ mutateAsync: vi.fn() }),
      },
      setProfileImage: {
        useMutation: () => ({ mutateAsync: vi.fn() }),
      },
    },
    uploads: {
      profileImagePresign: {
        useMutation: () => ({ mutateAsync: vi.fn() }),
      },
    },
  },
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}))

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual('@tanstack/react-router')
  return {
    ...actual,
    useNavigate: () => mocks.useRouterNavigate,
  }
})

const accountFixture = {
  id: 'account-1',
  name: 'Current Name',
  email: 'user@example.com',
  emailVerified: true,
  image: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updateProfile.mockResolvedValue(undefined)
  mocks.invalidateAccount.mockResolvedValue(undefined)
  mocks.invalidateGroups.mockResolvedValue(undefined)
  mocks.invalidateInvitations.mockResolvedValue(undefined)
  mocks.refetchAccount.mockResolvedValue(undefined)
  mocks.useCurrentAccount.mockReturnValue({
    data: accountFixture,
    isPending: false,
    isRefetching: false,
    error: null,
    refetch: mocks.refetchAccount,
  })
})

describe('AccountSettingsPage', () => {
  it('renders a single h1 and four h2 sections in the documented order', () => {
    render(<AccountSettingsPage />)

    const headings = screen.getAllByRole('heading')
    const h1Count = headings.filter(
      (heading) => heading.tagName === 'H1',
    ).length
    expect(h1Count).toBe(1)

    const h2Names = headings
      .filter((heading) => heading.tagName === 'H2')
      .map((heading) => heading.textContent ?? '')
    expect(h2Names).toEqual([
      'Profile',
      'App preferences',
      'Notifications',
      'AI features',
    ])
  })

  it('disables the profile Save button until the name changes', async () => {
    const { user } = render(<AccountSettingsPage />)
    const saveButton = screen.getByRole('button', { name: /save changes/i })
    expect(saveButton).toBeDisabled()

    const nameInput = screen.getByRole('textbox', { name: /display name/i })
    await user.clear(nameInput)
    await user.type(nameInput, 'New Name')

    await waitFor(() => {
      expect(saveButton).not.toBeDisabled()
    })
  })
})
