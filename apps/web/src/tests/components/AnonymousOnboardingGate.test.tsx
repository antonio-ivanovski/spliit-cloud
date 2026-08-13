import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AnonymousOnboardingGate } from '@/components/auth/anonymous-onboarding-gate'
import { render, screen, waitFor } from '@/test/test-utils'

const {
  acknowledgeMock,
  replaceLocationMock,
  replacePendingMock,
  setupMock,
  statusMock,
} = vi.hoisted(() => ({
  acknowledgeMock: vi.fn(),
  replaceLocationMock: vi.fn(),
  replacePendingMock: vi.fn(),
  setupMock: vi.fn(),
  statusMock: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useLocation: ({ select }: { select: (value: unknown) => unknown }) =>
    select({ pathname: '/' }),
}))

vi.mock('@/lib/browser-navigation', () => ({
  replaceBrowserLocation: replaceLocationMock,
}))

vi.mock('@/lib/use-current-account', () => ({
  useCurrentAccount: () => ({
    data: {
      id: 'anonymous-1',
      name: 'guest-1@anonymous.placeholder.local',
      email: 'guest-1@anonymous.placeholder.local',
      isAnonymous: true,
    },
    isPending: false,
  }),
}))

vi.mock('@/lib/anonymous-recovery', () => ({
  acknowledgeAnonymousRecovery: acknowledgeMock,
  getAnonymousRecoveryStatus: statusMock,
  replacePendingAnonymousRecovery: replacePendingMock,
  setupAnonymousRecovery: setupMock,
}))

describe('AnonymousOnboardingGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    sessionStorage.setItem('spliit.anonymous.redirect', '/groups')
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

  it('shows only a neutral loading state while setup status is unresolved', () => {
    statusMock.mockReturnValue(new Promise(() => undefined))

    render(
      <AnonymousOnboardingGate>
        <div>Protected app content</div>
      </AnonymousOnboardingGate>,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Save your sign in link')).not.toBeInTheDocument()
    expect(screen.queryByText('Protected app content')).not.toBeInTheDocument()
  })

  it('releases an acknowledged account without flashing the onboarding dialog', async () => {
    statusMock.mockResolvedValue({
      isAnonymous: true,
      hasRecoveryKey: true,
      acknowledged: true,
      onboardingCompleted: true,
      canResumeSetup: false,
    })

    render(
      <AnonymousOnboardingGate>
        <div>Protected app content</div>
      </AnonymousOnboardingGate>,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Save your sign in link')).not.toBeInTheDocument()
    expect(await screen.findByText('Protected app content')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('blocks app content until the sign in link is confirmed', async () => {
    const { user } = render(
      <AnonymousOnboardingGate>
        <div>Protected app content</div>
      </AnonymousOnboardingGate>,
    )

    expect(screen.queryByText('Protected app content')).not.toBeInTheDocument()
    expect(
      await screen.findByText('Save your sign in link'),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Display name')).not.toBeInTheDocument()
    expect(
      screen.getByDisplayValue(
        'https://app.example/auth/recover#code=spliit_anonymous_v1_test-key',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Open the sign in link in any browser/i),
    ).toBeInTheDocument()
    expect(
      screen.queryByDisplayValue('spliit_anonymous_v1_test-key'),
    ).not.toBeInTheDocument()

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
    expect(replaceLocationMock).toHaveBeenCalledWith(
      '/auth/complete-profile?redirect=%2Fgroups',
    )
    expect(acknowledgeMock).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Protected app content')).not.toBeInTheDocument()
  })

  it('reports a clipboard failure without confirming the link was copied', async () => {
    const { user } = render(
      <AnonymousOnboardingGate>
        <div>Protected app content</div>
      </AnonymousOnboardingGate>,
    )
    await screen.findByText('Save your sign in link')
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(
      new Error('clipboard unavailable'),
    )

    await user.click(screen.getByRole('button', { name: 'Copy link' }))

    expect(
      await screen.findByText(
        'Copy failed. Select the sign in link and copy it manually.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Copy link' }),
    ).toBeInTheDocument()
  })
})
