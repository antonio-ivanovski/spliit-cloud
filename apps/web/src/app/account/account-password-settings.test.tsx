import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen, waitFor, within } from '@/test/test-utils'

import { AccountPasswordSettings } from './account-password-settings'

const { changeMock, getStatusMock, removeMock, setMock, toastMock } =
  vi.hoisted(() => ({
    changeMock: vi.fn(),
    getStatusMock: vi.fn(),
    removeMock: vi.fn(),
    setMock: vi.fn(),
    toastMock: vi.fn(),
  }))

vi.mock('@/lib/password', async () => {
  class PasswordError extends Error {
    constructor(
      public readonly code: string,
      public readonly status: number,
    ) {
      super(code)
    }
  }
  return {
    PasswordError,
    changePassword: changeMock,
    getPasswordStatus: getStatusMock,
    removePassword: removeMock,
    setPassword: setMock,
  }
})

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: Record<string, unknown>) => (
    <a href={to as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}))

const STRONG = 'Str0ng!Pass'

describe('AccountPasswordSettings', () => {
  const onUpdated = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    onUpdated.mockResolvedValue(undefined)
    getStatusMock.mockResolvedValue({ hasPassword: false })
    setMock.mockResolvedValue({ success: true })
    changeMock.mockResolvedValue({ token: null })
    removeMock.mockResolvedValue({ success: true })
  })

  it('lets a verified-email account set a password', async () => {
    const { user } = render(
      <AccountPasswordSettings
        email="user@example.com"
        emailVerified
        isAnonymous={false}
        onUpdated={onUpdated}
      />,
    )

    expect(
      await screen.findByText(
        /set a password to sign in with email and password/i,
      ),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Set password' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('New password'), STRONG)
    await user.type(
      within(dialog).getByLabelText('Confirm new password'),
      STRONG,
    )
    await user.click(
      within(dialog).getByRole('button', { name: 'Set password' }),
    )

    await waitFor(() => expect(setMock).toHaveBeenCalledWith(STRONG))
    expect(onUpdated).toHaveBeenCalled()
    expect(toastMock).toHaveBeenCalledWith({ description: 'Password set.' })
  })

  it('disables set until the email is verified', async () => {
    render(
      <AccountPasswordSettings
        email="user@example.com"
        emailVerified={false}
        isAnonymous={false}
        onUpdated={onUpdated}
      />,
    )

    expect(
      await screen.findByText(
        /verify your email before you can set a password/i,
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set password' })).toBeDisabled()
  })

  it('asks the user to add an email before setting a password', async () => {
    render(
      <AccountPasswordSettings
        email="123@github.placeholder.local"
        emailVerified={false}
        isAnonymous={false}
        onUpdated={onUpdated}
      />,
    )

    expect(
      await screen.findByText(
        /add a verified email before you can set a password/i,
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set password' })).toBeDisabled()
  })

  it('blocks anonymous accounts from setting a password', async () => {
    render(
      <AccountPasswordSettings
        email="guest-1@anonymous.placeholder.local"
        emailVerified={false}
        isAnonymous
        onUpdated={onUpdated}
      />,
    )

    expect(
      await screen.findByText(/anonymous accounts must add a verified email/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set password' })).toBeDisabled()
  })

  it('shows change and remove when a password is already set', async () => {
    getStatusMock.mockResolvedValue({ hasPassword: true })
    const { user } = render(
      <AccountPasswordSettings
        email="user@example.com"
        emailVerified
        isAnonymous={false}
        onUpdated={onUpdated}
      />,
    )

    expect(
      await screen.findByRole('button', { name: 'Change password' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Remove password' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove password' }))
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByRole('heading', { name: 'Remove password?' }),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText(/you can still sign in with a magic link/i),
    ).toBeInTheDocument()

    await user.type(within(dialog).getByLabelText('Current password'), STRONG)
    await user.click(
      within(dialog).getByRole('button', { name: 'Remove password' }),
    )

    await waitFor(() =>
      expect(removeMock).toHaveBeenCalledWith({ currentPassword: STRONG }),
    )
    expect(onUpdated).toHaveBeenCalled()
  })
})
