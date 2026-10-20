import { useEffect, useReducer } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { act, render, screen, waitFor } from '@/test/test-utils'

const { mockGetStatus, mockSetup, connection } = vi.hoisted(() => ({
  mockGetStatus: vi.fn(),
  mockSetup: vi.fn(),
  connection: { online: true },
}))

vi.mock('@/lib/anonymous-recovery', () => ({
  getAnonymousRecoveryStatus: (...args: unknown[]) => mockGetStatus(...args),
  setupAnonymousRecovery: (...args: unknown[]) => mockSetup(...args),
  acknowledgeAnonymousRecovery: vi.fn(),
  replacePendingAnonymousRecovery: vi.fn(),
}))

vi.mock('@/lib/connectivity', () => ({
  reportNetworkFailure: vi.fn(),
}))

vi.mock('@/lib/use-online-status', () => ({
  useOnlineStatus: () => connection.online,
  useConnectivityStatus: () => (connection.online ? 'online' : 'offline'),
}))

vi.mock('react-i18next', async (importOriginal) => {
  const original = await importOriginal<object>()
  return {
    ...original,
    useTranslation: () => ({ t: (key: string) => key }),
  }
})

import { AnonymousRecoveryOnboarding } from '@/components/auth/anonymous-recovery-onboarding'

describe('AnonymousRecoveryOnboarding setup lifecycle', () => {
  beforeEach(() => {
    connection.online = true
    mockGetStatus.mockReset()
    mockSetup.mockReset()
  })
  it('runs key setup once even when onComplete identity churns', async () => {
    mockGetStatus.mockResolvedValue({
      acknowledged: false,
      onboardingCompleted: false,
      hasPasskey: false,
    })
    mockSetup.mockResolvedValue({ code: 'code-1', recoveryUrl: 'https://x' })

    function Host() {
      const [, force] = useReducer((n: number) => n + 1, 0)
      useEffect(() => {
        force()
        force()
        force()
      }, [])
      // Deliberately unstable identity, like the pre-fix hosts.
      return (
        <AnonymousRecoveryOnboarding onComplete={() => Promise.resolve()} />
      )
    }

    render(<Host />, { reactStrictMode: true })
    await waitFor(() => {
      expect(screen.getByText('start')).toBeInTheDocument()
    })
    expect(mockGetStatus).toHaveBeenCalledTimes(1)
    expect(mockSetup).toHaveBeenCalledTimes(1)
  })

  it('restarts after reconnect without completing a cancelled status request', async () => {
    let resolveFirst!: (status: {
      acknowledged: boolean
      onboardingCompleted: boolean
      hasPasskey: boolean
    }) => void
    mockGetStatus
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
      )
      .mockResolvedValue({
        acknowledged: false,
        onboardingCompleted: false,
        hasPasskey: false,
      })
    mockSetup.mockResolvedValue({
      code: 'reconnected',
      recoveryUrl: 'https://x',
    })
    const completed = vi.fn()
    const { rerender } = render(
      <AnonymousRecoveryOnboarding onComplete={completed} />,
    )
    await waitFor(() => expect(mockGetStatus).toHaveBeenCalledTimes(1))
    connection.online = false
    rerender(<AnonymousRecoveryOnboarding onComplete={completed} />)
    await act(async () => {
      resolveFirst({
        acknowledged: false,
        onboardingCompleted: false,
        hasPasskey: true,
      })
    })
    expect(completed).not.toHaveBeenCalled()
    connection.online = true
    rerender(<AnonymousRecoveryOnboarding onComplete={completed} />)
    await waitFor(() => expect(screen.getByText('start')).toBeInTheDocument())
    expect(mockGetStatus).toHaveBeenCalledTimes(2)
    expect(mockSetup).toHaveBeenCalledTimes(1)
  })
})
