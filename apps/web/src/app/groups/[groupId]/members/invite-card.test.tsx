import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'

import { InviteCard } from './invite-card'
import { useQrSession } from './members-hooks'

const mocks = vi.hoisted(() => ({
  friendsQuery: vi.fn(),
  createQrLinkMutateAsync: vi.fn(),
  revokeMutateAsync: vi.fn(),
  invitationsListQuery: vi.fn(),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    account: {
      friends: {
        useQuery: mocks.friendsQuery,
      },
    },
    invitations: {
      createQrLink: {
        useMutation: (options?: {
          onSuccess?: (data: unknown) => void | Promise<void>
        }) => ({
          mutateAsync: async (args: unknown) => {
            const result = await mocks.createQrLinkMutateAsync(args)
            await options?.onSuccess?.(result)
            return result
          },
          isPending: false,
        }),
      },
      revoke: {
        useMutation: (options?: {
          onSuccess?: (data: unknown) => void | Promise<void>
        }) => ({
          mutateAsync: async (args: unknown) => {
            const result = await mocks.revokeMutateAsync(args)
            await options?.onSuccess?.(result)
            return result
          },
          isPending: false,
        }),
      },
      list: {
        useQuery: mocks.invitationsListQuery,
      },
    },
    useUtils: () => ({
      invitations: {
        list: { invalidate: vi.fn(async () => undefined) },
      },
    }),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  mocks.friendsQuery.mockReturnValue({
    data: { friends: [] },
    isLoading: false,
  })
  mocks.invitationsListQuery.mockReturnValue({ data: undefined })
})

function renderCard(
  overrides: Omit<
    Partial<ComponentProps<typeof InviteCard>>,
    'qrSession' | 'onQrSessionChange'
  > = {},
) {
  function Wrapper() {
    const [qrSession, setQrSession] = useQrSession('grp-1')
    return (
      <InviteCard
        groupId="grp-1"
        groupName="Roadtrip"
        canInviteAdmin
        createMutation={{ isPending: false }}
        createLinkMutation={{ isPending: false }}
        createParticipantMutation={{ isPending: false }}
        onInvite={vi.fn().mockResolvedValue(true)}
        onGenerateLink={vi.fn().mockResolvedValue(undefined)}
        onAddParticipant={vi.fn().mockResolvedValue(true)}
        qrSession={qrSession}
        onQrSessionChange={setQrSession}
        {...overrides}
      />
    )
  }
  return render(<Wrapper />)
}

describe('InviteCard responsive navigation', () => {
  it('uses one compact selector for the five add-person paths', async () => {
    const { user } = renderCard()

    const selector = screen.getByRole('combobox', { name: 'Add people' })
    expect(selector).toHaveTextContent('Email')
    expect(screen.getByRole('tab', { name: 'No account' })).toBeInTheDocument()

    await user.click(selector)
    await user.click(screen.getByRole('option', { name: 'No account' }))

    expect(
      screen.getByText(/without inviting them to Spliit/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('textbox', { name: 'Temporary name' }),
    ).toBeInTheDocument()
  })

  it('keeps an unlinked-participant draft when a guarded submit is ignored', async () => {
    const onAddParticipant = vi.fn().mockResolvedValue(false)
    const { user } = renderCard({ onAddParticipant })

    await user.click(screen.getByRole('tab', { name: 'No account' }))
    const name = screen.getByRole('textbox', { name: 'Temporary name' })
    await user.type(name, 'Charlie')
    await user.click(screen.getByRole('button', { name: 'Add participant' }))

    await vi.waitFor(() => expect(onAddParticipant).toHaveBeenCalledOnce())
    expect(name).toHaveValue('Charlie')
  })

  it('keeps a link draft when a guarded submit is ignored', async () => {
    const onGenerateLink = vi.fn().mockResolvedValue(undefined)
    const { user } = renderCard({ onGenerateLink })

    await user.click(screen.getByRole('tab', { name: 'Invite link' }))
    const name = screen.getByRole('textbox', {
      name: 'Temporary name (optional)',
    })
    await user.type(name, 'Charlie')
    await user.click(
      screen.getByRole('button', { name: 'Generate invite link' }),
    )

    await vi.waitFor(() => expect(onGenerateLink).toHaveBeenCalledOnce())
    expect(name).toHaveValue('Charlie')
  })
})

describe('InviteCard QR nearby session', () => {
  const qrInviteUrl =
    'https://spliit.example/groups/grp-1?invite=aGVsbG8td29ybGQtdG9rZW4tMTIzNDU2'

  beforeEach(() => {
    mocks.createQrLinkMutateAsync.mockResolvedValue({
      invitationId: 'inv-qr-1',
      inviteUrl: qrInviteUrl,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      temporaryName: null,
      role: 'MEMBER',
      isMultiUse: true,
      useCount: 0,
    })
    mocks.revokeMutateAsync.mockResolvedValue({})
  })

  it('shows QR as a top-level tab, not inside the invite-link tab', async () => {
    const { user } = renderCard()

    await user.click(screen.getByRole('tab', { name: 'Invite link' }))
    expect(
      screen.queryByRole('button', { name: 'Show QR code' }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'QR code' }))
    expect(
      screen.getByRole('button', { name: 'Show QR code' }),
    ).toBeInTheDocument()
  })

  it('generates a session and renders the code with joiners, scan-only', async () => {
    mocks.invitationsListQuery.mockReturnValue({
      data: {
        invitations: [
          {
            id: 'inv-qr-1',
            type: 'LINK',
            isMultiUse: true,
            useCount: 2,
            recentJoiners: [
              {
                accountId: 'acct-alice',
                name: 'Alice',
                image: null,
                joinedAt: new Date(),
              },
            ],
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          },
        ],
      },
    })
    // A reloaded browser resumes its own session from storage.
    window.localStorage.setItem(
      'spliit:qr-session:grp-1',
      JSON.stringify({
        invitationId: 'inv-qr-1',
        inviteUrl: qrInviteUrl,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      }),
    )
    const { user } = renderCard()

    await user.click(screen.getByRole('tab', { name: 'QR code' }))

    expect(mocks.createQrLinkMutateAsync).not.toHaveBeenCalled()
    expect(screen.getByTestId('qr-invite-code')).toBeInTheDocument()
    expect(screen.getByTestId('qr-invite-joined-count')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    // Scan-only: no URL text, copy, or share leaves this screen.
    expect(screen.queryByDisplayValue(qrInviteUrl)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Copy invite link' }),
    ).not.toBeInTheDocument()
  })

  it('keeps the displayed code when switching tabs', async () => {
    const { user } = renderCard()

    await user.click(screen.getByRole('tab', { name: 'QR code' }))
    await user.click(screen.getByRole('button', { name: 'Show QR code' }))
    await vi.waitFor(() =>
      expect(screen.getByTestId('qr-invite-code')).toBeInTheDocument(),
    )

    await user.click(screen.getByRole('tab', { name: 'Email' }))
    expect(screen.queryByTestId('qr-invite-code')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'QR code' }))
    expect(screen.getByTestId('qr-invite-code')).toBeInTheDocument()
    expect(mocks.createQrLinkMutateAsync).toHaveBeenCalledOnce()
  })

  it('drops a stale stored session revoked elsewhere instead of showing a zombie code', async () => {
    // Revoked from another device, then this browser reloads: storage still
    // holds the code but the first fresh list does not contain it.
    window.localStorage.setItem(
      'spliit:qr-session:grp-1',
      JSON.stringify({
        invitationId: 'inv-qr-dead',
        inviteUrl: qrInviteUrl,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        createdAt: Date.now() - 60_000,
      }),
    )
    mocks.invitationsListQuery.mockReturnValue({
      data: { invitations: [] },
    })
    const { user } = renderCard()

    await user.click(screen.getByRole('tab', { name: 'QR code' }))

    await vi.waitFor(() =>
      expect(screen.queryByTestId('qr-invite-code')).not.toBeInTheDocument(),
    )
    expect(
      screen.getByRole('button', { name: 'Show QR code' }),
    ).toBeInTheDocument()
    expect(mocks.createQrLinkMutateAsync).not.toHaveBeenCalled()
    expect(window.localStorage.getItem('spliit:qr-session:grp-1')).toBeNull()
  })

  it('trusts a just-created stored session while the list lags behind', async () => {
    window.localStorage.setItem(
      'spliit:qr-session:grp-1',
      JSON.stringify({
        invitationId: 'inv-qr-fresh',
        inviteUrl: qrInviteUrl,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        createdAt: Date.now(),
      }),
    )
    mocks.invitationsListQuery.mockReturnValue({
      data: { invitations: [] },
    })
    const { user } = renderCard()

    await user.click(screen.getByRole('tab', { name: 'QR code' }))

    expect(screen.getByTestId('qr-invite-code')).toBeInTheDocument()
  })

  it('takes over an active session started elsewhere instead of duplicating it', async () => {
    mocks.invitationsListQuery.mockReturnValue({
      data: {
        invitations: [
          {
            id: 'inv-qr-other',
            type: 'LINK',
            isMultiUse: true,
            useCount: 1,
            recentJoiners: [],
            canRevoke: true,
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
          },
        ],
      },
    })
    const { user } = renderCard()

    await user.click(screen.getByRole('tab', { name: 'QR code' }))

    expect(screen.queryByTestId('qr-invite-code')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Take over & show new code' }),
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Take over & show new code' }),
    )

    await vi.waitFor(() =>
      expect(mocks.revokeMutateAsync).toHaveBeenCalledWith({
        invitationId: 'inv-qr-other',
      }),
    )
    await vi.waitFor(() =>
      expect(mocks.createQrLinkMutateAsync).toHaveBeenCalledOnce(),
    )
  })

  it('stops sharing by revoking the session', async () => {
    const { user } = renderCard()

    await user.click(screen.getByRole('tab', { name: 'QR code' }))
    await user.click(screen.getByRole('button', { name: 'Show QR code' }))
    await vi.waitFor(() =>
      expect(screen.getByTestId('qr-invite-code')).toBeInTheDocument(),
    )

    await user.click(screen.getByRole('button', { name: 'Stop sharing' }))

    await vi.waitFor(() =>
      expect(mocks.revokeMutateAsync).toHaveBeenCalledWith({
        invitationId: 'inv-qr-1',
      }),
    )
    await vi.waitFor(() =>
      expect(screen.queryByTestId('qr-invite-code')).not.toBeInTheDocument(),
    )
  })
})
