import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useInvitationAcceptance } from './use-invitation-acceptance'

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  acceptEmail: vi.fn(),
  acceptLink: vi.fn(),
  navigate: vi.fn(),
  fetchMember: vi.fn(),
  invalidate: vi.fn(async () => undefined),
  status: {
    account: { id: 'invitee', isAnonymous: false },
    authReturnSettled: true,
    onboardingComplete: true,
    statusError: null,
    refetchStatus: vi.fn(),
  },
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@/lib/use-online-status', () => ({ useOnlineStatus: () => true }))
vi.mock('@/lib/use-onboarding-status', () => ({
  useOnboardingStatus: () => mocks.status,
}))
vi.mock('@/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      client: {
        groups: { get: { query: mocks.read } },
        invitations: {
          accept: { mutate: mocks.acceptEmail },
          acceptLink: { mutate: mocks.acceptLink },
        },
      },
      groups: {
        get: { invalidate: mocks.invalidate, fetch: mocks.fetchMember },
      },
      account: {
        groups: { invalidate: mocks.invalidate },
        members: { invalidate: mocks.invalidate },
      },
      overview: { get: { invalidate: mocks.invalidate } },
      invitations: {
        list: { invalidate: mocks.invalidate },
        listForAccount: { invalidate: mocks.invalidate },
      },
    }),
  },
}))

let queryClient: QueryClient
beforeEach(() => {
  vi.clearAllMocks()
  mocks.status.onboardingComplete = true
  mocks.read.mockResolvedValue({ currentMember: null })
  mocks.fetchMember.mockResolvedValue({ currentMember: { id: 'member' } })
  mocks.acceptEmail.mockResolvedValue({ groupId: 'group' })
  mocks.acceptLink.mockResolvedValue({ groupId: 'group' })
  queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
})
afterEach(() => queryClient.clear())
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <StrictMode>
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  </StrictMode>
)

describe('invitation acceptance command', () => {
  it.each([false, true])(
    'accepts the selected personal email invitation, preserving precedence over sibling link proof (auth action: %s)',
    async (automatic) => {
      const { result } = renderHook(
        () =>
          useInvitationAcceptance({
            groupId: 'group',
            invitationId: 'personal',
            token: 'sibling-link',
            invitationAction: automatic ? 'accept' : undefined,
          }),
        { wrapper },
      )
      await act(async () => {
        await Promise.resolve()
      })
      if (!automatic) {
        expect(mocks.acceptEmail).not.toHaveBeenCalled()
        await act(async () => {
          await result.current.mutateAsync({ invitationId: 'personal' })
        })
      } else {
        await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1))
      }
      expect(mocks.acceptEmail).toHaveBeenCalledWith({
        invitationId: 'personal',
        expectedGroupId: 'group',
      })
      expect(mocks.acceptLink).not.toHaveBeenCalled()
      expect(mocks.navigate).toHaveBeenCalledWith(
        expect.objectContaining({
          to: '/groups/$groupId/expenses',
          search: {
            invite: undefined,
            viewKey: undefined,
            invitation: undefined,
            invitationAction: undefined,
          },
          replace: true,
        }),
      )
    },
  )

  it('uses the authenticated personal invitation discovered after a link sign-in', async () => {
    mocks.read.mockResolvedValue({
      currentMember: null,
      currentInvitation: { id: 'personal', type: 'EMAIL' },
    })
    renderHook(
      () =>
        useInvitationAcceptance({
          groupId: 'group',
          token: 'credential',
          invitationAction: 'accept',
        }),
      { wrapper },
    )
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1))
    expect(mocks.acceptEmail).toHaveBeenCalledWith({
      invitationId: 'personal',
      expectedGroupId: 'group',
    })
    expect(mocks.acceptLink).not.toHaveBeenCalled()
  })

  it('does not redeem or navigate an obsolete intent after leaving its group', async () => {
    let resolveRead!: (value: { currentMember: null }) => void
    mocks.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve
        }),
    )
    const { rerender } = renderHook(
      ({ groupId, token }) =>
        useInvitationAcceptance({
          groupId,
          token,
          invitationAction: 'accept',
        }),
      { wrapper, initialProps: { groupId: 'first', token: 'first-token' } },
    )
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1))
    rerender({ groupId: 'second', token: 'second-token' })
    await act(async () => resolveRead({ currentMember: null }))
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1))
    expect(mocks.acceptLink).toHaveBeenCalledTimes(1)
    expect(mocks.acceptLink).toHaveBeenCalledWith({
      token: 'second-token',
      expectedGroupId: 'second',
    })
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ params: { groupId: 'second' } }),
    )
  })

  it('waits for authoritative setup and issues one acceptance under StrictMode', async () => {
    mocks.status.onboardingComplete = false
    const { rerender } = renderHook(
      () =>
        useInvitationAcceptance({
          groupId: 'group',
          token: 'credential',
          invitationAction: 'accept',
        }),
      { wrapper },
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(mocks.acceptLink).not.toHaveBeenCalled()
    mocks.status.onboardingComplete = true
    rerender()
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1))
    expect(mocks.acceptLink).toHaveBeenCalledTimes(1)
    expect(mocks.acceptLink).toHaveBeenCalledWith({
      token: 'credential',
      expectedGroupId: 'group',
    })
  })

  it('preserves a failed intent for deliberate retry without navigating or consuming again after membership exists', async () => {
    mocks.acceptLink.mockRejectedValueOnce(new Error('Link full'))
    const { result } = renderHook(
      () =>
        useInvitationAcceptance({
          groupId: 'group',
          token: 'credential',
          invitationAction: 'accept',
        }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.error?.message).toBe('Link full'))
    expect(mocks.navigate).not.toHaveBeenCalled()
    mocks.read.mockResolvedValue({ currentMember: { id: 'member' } })
    act(() => result.current.retryAcceptance())
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1))
    expect(mocks.acceptLink).toHaveBeenCalledTimes(1)
  })
})
