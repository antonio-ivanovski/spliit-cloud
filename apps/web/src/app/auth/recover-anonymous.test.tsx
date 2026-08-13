import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen, waitFor } from '@/test/test-utils'

import { RecoverAnonymousAccountPage } from './recover-anonymous'

const { MockRecoveryError, recoverMock } = vi.hoisted(() => {
  class RecoveryError extends Error {
    constructor(
      public readonly code: string,
      public readonly status: number,
      public readonly displayName?: string,
    ) {
      super(code)
    }
  }
  return { MockRecoveryError: RecoveryError, recoverMock: vi.fn() }
})

vi.mock('@/lib/anonymous-recovery', () => ({
  AnonymousRecoveryError: MockRecoveryError,
  parseAnonymousRecoveryLink: (value: string) => {
    const trimmed = value.trim()
    try {
      const url = new URL(trimmed)
      const code = new URLSearchParams(url.hash.slice(1)).get('code')
      return code && /^spliit_anonymous_v1_[A-Za-z0-9_-]{43}$/.test(code)
        ? code
        : null
    } catch {
      return null
    }
  },
  recoverAnonymousAccount: recoverMock,
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: Record<string, unknown>) => (
    <a href={to as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}))

describe('RecoverAnonymousAccountPage', () => {
  const savedKey = `spliit_anonymous_v1_${'a'.repeat(43)}`
  const savedLink = `https://app.example/auth/recover#code=${savedKey}`

  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/auth/recover')
  })

  it('removes a fragment key before recovery and confirms account switching', async () => {
    recoverMock
      .mockRejectedValueOnce(
        new MockRecoveryError(
          'ANONYMOUS_RECOVERY_ACCOUNT_CONFLICT',
          409,
          'Ada',
        ),
      )
      .mockRejectedValueOnce(new MockRecoveryError('STOP_AFTER_ASSERTION', 400))
    window.history.replaceState({}, '', `/auth/recover#code=${savedKey}`)

    const { user } = render(<RecoverAnonymousAccountPage />)

    await waitFor(() =>
      expect(recoverMock).toHaveBeenCalledWith({
        code: savedKey,
        replaceCurrentSession: false,
      }),
    )
    expect(window.location.hash).toBe('')
    expect(
      await screen.findByText(
        'You are already signed in. Continue to switch this browser to Ada.',
      ),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Switch and sign in' }))

    await waitFor(() =>
      expect(recoverMock).toHaveBeenLastCalledWith({
        code: savedKey,
        replaceCurrentSession: true,
      }),
    )
  })

  it('shows only recovery progress while automatically submitting a link', () => {
    recoverMock.mockReturnValue(new Promise(() => undefined))
    window.history.replaceState({}, '', `/auth/recover#code=${savedKey}`)

    render(<RecoverAnonymousAccountPage />)

    expect(screen.getByText('Signing in to your account…')).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Sign in to anonymous account' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Sign in link')).not.toBeInTheDocument()
  })

  it('accepts a complete sign in link entered in an installed PWA', async () => {
    recoverMock.mockRejectedValue(
      new MockRecoveryError('INVALID_RECOVERY_KEY', 400),
    )
    const { user } = render(<RecoverAnonymousAccountPage />)

    await user.type(screen.getByLabelText('Sign in link'), savedLink)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() =>
      expect(recoverMock).toHaveBeenCalledWith({
        code: savedKey,
        replaceCurrentSession: false,
      }),
    )
    expect(
      screen.getByText(
        /In the installed PWA, choose Anonymous and paste the complete saved link/i,
      ),
    ).toBeInTheDocument()
  })

  it('rejects a malformed sign in link without submitting it', async () => {
    const { user } = render(<RecoverAnonymousAccountPage />)

    await user.type(screen.getByLabelText('Sign in link'), 'not a link')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(recoverMock).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This sign in link is invalid.',
    )
  })
})
