import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen, waitFor, within } from '@/test/test-utils'

import { InviteCard } from './invite-card'
import { useQrSession } from './members-hooks'

const mocks = vi.hoisted(() => ({
  friendsQuery: vi.fn(),
  createQrLinkMutateAsync: vi.fn(),
  revokeMutateAsync: vi.fn(),
  invitationsListQuery: vi.fn(),
}))

vi.mock('@/lib/deployment-config', () => ({
  useDeploymentConfig: () => ({
    emailDeliveryEnabled: true,
  }),
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
          mutate: (args: unknown) => {
            void (async () => {
              const result = await mocks.revokeMutateAsync(args)
              await options?.onSuccess?.(result)
            })()
          },
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
        createSharedLinkMutation={{ isPending: false }}
        createParticipantMutation={{ isPending: false }}
        onInvite={vi.fn().mockResolvedValue(true)}
        onGenerateLink={vi.fn().mockResolvedValue(undefined)}
        onGenerateSharedLink={vi.fn().mockResolvedValue(undefined)}
        onAddParticipant={vi.fn().mockResolvedValue(true)}
        qrSession={qrSession}
        onQrSessionChange={setQrSession}
        {...overrides}
      />
    )
  }
  const result = render(<Wrapper />)
  return { ...result, refresh: () => result.rerender(<Wrapper />) }
}

describe('InviteCard responsive navigation', () => {
  it('keeps the selected invite method when a delayed friends response arrives', async () => {
    mocks.friendsQuery.mockReturnValue({ data: undefined, isLoading: true })
    const { user, refresh } = renderCard()
    await user.click(screen.getByRole('tab', { name: 'Invite link' }))
    expect(screen.getByRole('tab', { name: 'Invite link' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    mocks.friendsQuery.mockReturnValue({
      data: {
        friends: [
          {
            accountId: 'friend',
            name: 'A friend',
            email: 'friend@example.com',
            isMember: false,
          },
        ],
      },
      isLoading: false,
    })
    refresh()
    expect(screen.getByRole('tab', { name: 'Invite link' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tab', { name: 'Multiple people' })).toBeVisible()
  })

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

    await waitFor(() => expect(onAddParticipant).toHaveBeenCalledOnce())
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

    await waitFor(() => expect(onGenerateLink).toHaveBeenCalledOnce())
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
    await waitFor(() =>
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

    await waitFor(() =>
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

    await waitFor(() =>
      expect(mocks.revokeMutateAsync).toHaveBeenCalledWith({
        invitationId: 'inv-qr-other',
      }),
    )
    await waitFor(() =>
      expect(mocks.createQrLinkMutateAsync).toHaveBeenCalledOnce(),
    )
  })

  it('asks for confirmation before stopping sharing', async () => {
    const { user } = renderCard()

    await user.click(screen.getByRole('tab', { name: 'QR code' }))
    await user.click(screen.getByRole('button', { name: 'Show QR code' }))
    await waitFor(() =>
      expect(screen.getByTestId('qr-invite-code')).toBeInTheDocument(),
    )

    await user.click(screen.getByRole('button', { name: 'Stop sharing' }))

    // The destructive action waits behind a confirmation dialog.
    expect(
      screen.getByRole('heading', { name: 'Expire this QR code?' }),
    ).toBeInTheDocument()
    expect(mocks.revokeMutateAsync).not.toHaveBeenCalled()

    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Stop sharing',
      }),
    )
    await waitFor(() =>
      expect(mocks.revokeMutateAsync).toHaveBeenCalledWith({
        invitationId: 'inv-qr-1',
      }),
    )
    await waitFor(() =>
      expect(screen.queryByTestId('qr-invite-code')).not.toBeInTheDocument(),
    )
  })

  it('cancelling stop-sharing fires no mutation', async () => {
    const { user } = renderCard()

    await user.click(screen.getByRole('tab', { name: 'QR code' }))
    await user.click(screen.getByRole('button', { name: 'Show QR code' }))
    await waitFor(() =>
      expect(screen.getByTestId('qr-invite-code')).toBeInTheDocument(),
    )

    await user.click(screen.getByRole('button', { name: 'Stop sharing' }))
    expect(
      screen.getByRole('heading', { name: 'Expire this QR code?' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Expire this QR code?' }),
      ).not.toBeInTheDocument(),
    )
    expect(mocks.revokeMutateAsync).not.toHaveBeenCalled()
    expect(screen.getByTestId('qr-invite-code')).toBeInTheDocument()
  })

  it('ignores shared links: they are copy-anytime URLs, not QR sessions', async () => {
    // A live shared link must not surface as a scannable code, must not be
    // taken over, and must not clear a stored session that the list no
    // longer confirms.
    mocks.invitationsListQuery.mockReturnValue({
      data: {
        invitations: [
          {
            id: 'inv-shared-1',
            type: 'LINK',
            isMultiUse: true,
            isShared: true,
            useCount: 3,
            maxUses: 10,
            endedReason: null,
            recentJoiners: [],
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        ],
      },
    })
    const { user } = renderCard()

    await user.click(screen.getByRole('tab', { name: 'QR code' }))

    expect(screen.queryByTestId('qr-invite-code')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Take over & show new code' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Show QR code' }),
    ).toBeInTheDocument()
  })

  it('treats a full session as dead: the tab falls back to the empty state', async () => {
    // `endedReason: 'full'` is the server authority — the tab must not show
    // a code whose joins the accept gate would reject.
    mocks.invitationsListQuery.mockReturnValue({
      data: {
        invitations: [
          {
            id: 'inv-qr-full',
            type: 'LINK',
            isMultiUse: true,
            isShared: false,
            useCount: 30,
            maxUses: 30,
            endedReason: 'full',
            recentJoiners: [],
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
          },
        ],
      },
    })
    const { user } = renderCard()

    await user.click(screen.getByRole('tab', { name: 'QR code' }))

    expect(screen.queryByTestId('qr-invite-code')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Take over & show new code' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Show QR code' }),
    ).toBeInTheDocument()
  })
})

describe('InviteCard shared links', () => {
  const sharedInviteUrl =
    'https://spliit.example/groups/grp-1?invite=c2hhcmVkLWxpbmstdG9rZW4tMTIzNDU2'

  it('creates an unlimited 7-day shared link by default', async () => {
    const onGenerateSharedLink = vi.fn().mockResolvedValue({
      inviteUrl: sharedInviteUrl,
      role: 'MEMBER',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      maxUses: null,
      label: 'Family chat',
      isShared: true,
    })
    const { user } = renderCard({ onGenerateSharedLink })

    await user.click(screen.getByRole('tab', { name: 'Invite link' }))
    // One-time mode is the default: no shared fields visible yet.
    expect(
      screen.queryByRole('textbox', { name: 'Link label (optional)' }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Multiple people' }))
    const label = screen.getByRole('textbox', { name: 'Link label (optional)' })
    await user.type(label, 'Family chat')

    await user.click(
      screen.getByRole('button', { name: 'Generate invite link' }),
    )

    // Defaults: unlimited joins, 7-day expiry.
    await waitFor(() =>
      expect(onGenerateSharedLink).toHaveBeenCalledWith({
        label: 'Family chat',
        maxUses: null,
        expiresIn: { amount: 7, unit: 'days' },
      }),
    )
    // The shared result panel renders the URL with the copy-again note.
    expect(screen.getByDisplayValue(sharedInviteUrl)).toBeInTheDocument()
    expect(
      screen.getByText(/copy this link again from Pending invitations/i),
    ).toBeInTheDocument()
  })

  it('submits capped presets chosen from the pickers', async () => {
    const onGenerateSharedLink = vi.fn().mockResolvedValue({
      inviteUrl: sharedInviteUrl,
      role: 'MEMBER',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      maxUses: 10,
      label: null,
      isShared: true,
    })
    const { user } = renderCard({ onGenerateSharedLink })

    await user.click(screen.getByRole('tab', { name: 'Invite link' }))
    await user.click(screen.getByRole('tab', { name: 'Multiple people' }))

    // Join limit: Unlimited → 10 joins.
    await user.click(screen.getByRole('combobox', { name: 'Join limit' }))
    await user.click(screen.getByRole('option', { name: '10 joins' }))
    // Expiry: 7 days → 24 hours.
    await user.click(screen.getByRole('combobox', { name: 'Expires in' }))
    await user.click(screen.getByRole('option', { name: '24 hours' }))

    await user.click(
      screen.getByRole('button', { name: 'Generate invite link' }),
    )

    await waitFor(() =>
      expect(onGenerateSharedLink).toHaveBeenCalledWith({
        label: undefined,
        maxUses: 10,
        expiresIn: { amount: 24, unit: 'hours' },
      }),
    )
  })

  it('reveals custom inputs through Other and submits the typed values', async () => {
    const onGenerateSharedLink = vi.fn().mockResolvedValue({
      inviteUrl: sharedInviteUrl,
      role: 'MEMBER',
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      maxUses: 42,
      label: null,
      isShared: true,
    })
    const { user } = renderCard({ onGenerateSharedLink })

    await user.click(screen.getByRole('tab', { name: 'Invite link' }))
    await user.click(screen.getByRole('tab', { name: 'Multiple people' }))

    // No custom inputs until Other is picked.
    expect(
      screen.queryByRole('spinbutton', { name: 'Join limit' }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Join limit' }))
    await user.click(screen.getByRole('option', { name: 'Other…' }))
    const capInput = screen.getByRole('spinbutton', { name: 'Join limit' })
    await user.clear(capInput)
    await user.type(capInput, '42')

    await user.click(screen.getByRole('combobox', { name: 'Expires in' }))
    await user.click(screen.getByRole('option', { name: 'Other…' }))
    const amountInput = screen.getByRole('spinbutton', { name: 'Expires in' })
    await user.clear(amountInput)
    await user.type(amountInput, '3')

    await user.click(
      screen.getByRole('button', { name: 'Generate invite link' }),
    )

    await waitFor(() =>
      expect(onGenerateSharedLink).toHaveBeenCalledWith({
        label: undefined,
        maxUses: 42,
        expiresIn: { amount: 3, unit: 'days' },
      }),
    )
  })

  it('rejects an Other join limit left empty', async () => {
    const onGenerateSharedLink = vi.fn().mockResolvedValue(undefined)
    const { user } = renderCard({ onGenerateSharedLink })

    await user.click(screen.getByRole('tab', { name: 'Invite link' }))
    await user.click(screen.getByRole('tab', { name: 'Multiple people' }))

    await user.click(screen.getByRole('combobox', { name: 'Join limit' }))
    await user.click(screen.getByRole('option', { name: 'Other…' }))
    // Empty custom input: null is only valid for Unlimited, not Other.
    await user.click(
      screen.getByRole('button', { name: 'Generate invite link' }),
    )

    expect(await screen.findByText(/join limit between/i)).toBeInTheDocument()
    expect(onGenerateSharedLink).not.toHaveBeenCalled()
  })

  it('shows a live summary of the chosen limits', async () => {
    const { user } = renderCard({
      onGenerateSharedLink: vi.fn().mockResolvedValue(undefined),
    })

    await user.click(screen.getByRole('tab', { name: 'Invite link' }))
    await user.click(screen.getByRole('tab', { name: 'Multiple people' }))

    // Default: unlimited joins, 7-day expiry with a projected datetime.
    // The summary note is the `role="note"` paragraph (the preset trigger
    // shows the same words, so scope past it).
    const summary = screen.getByRole('note')
    expect(summary).toHaveTextContent(/Unlimited joins/i)
    expect(summary).toHaveTextContent(/expires in 7 days \(/i)
  })

  it('projects the exact expiry datetime for a capped custom limit', async () => {
    const { user } = renderCard({
      onGenerateSharedLink: vi.fn().mockResolvedValue(undefined),
    })

    await user.click(screen.getByRole('tab', { name: 'Invite link' }))
    await user.click(screen.getByRole('tab', { name: 'Multiple people' }))

    await user.click(screen.getByRole('combobox', { name: 'Join limit' }))
    await user.click(screen.getByRole('option', { name: 'Other…' }))
    const capInput = screen.getByRole('spinbutton', { name: 'Join limit' })
    await user.clear(capInput)
    await user.type(capInput, '5')

    // The summary pins the moment the link dies, not just the duration.
    const summary = screen.getByRole('note')
    expect(summary).toHaveTextContent(/Up to 5 people can join/i)
    expect(summary).toHaveTextContent(/expires in 7 days \(.+, .+\)/)
  })

  it('blocks submit when the custom expiry is empty', async () => {
    const onGenerateSharedLink = vi.fn().mockResolvedValue(undefined)
    const { user } = renderCard({ onGenerateSharedLink })

    await user.click(screen.getByRole('tab', { name: 'Invite link' }))
    await user.click(screen.getByRole('tab', { name: 'Multiple people' }))

    await user.click(screen.getByRole('combobox', { name: 'Expires in' }))
    await user.click(screen.getByRole('option', { name: 'Other…' }))
    await user.clear(screen.getByRole('spinbutton', { name: 'Expires in' }))

    // Cleared Other holds null, which submit rejects — the summary shows
    // the unfinished duration line (not the never-expires line).
    const summary = screen.getByRole('note')
    expect(summary).toHaveTextContent(/Unlimited joins · expires in 7 days\./)
    await user.click(
      screen.getByRole('button', { name: 'Generate invite link' }),
    )
    expect(await screen.findByText(/expiry between/i)).toBeInTheDocument()
    expect(onGenerateSharedLink).not.toHaveBeenCalled()
  })

  it('names the join count in the created-link intro', async () => {
    const onGenerateSharedLink = vi.fn().mockResolvedValue({
      inviteUrl: sharedInviteUrl,
      role: 'MEMBER',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      maxUses: 10,
      label: null,
      isShared: true,
    })
    const { user } = renderCard({ onGenerateSharedLink })

    await user.click(screen.getByRole('tab', { name: 'Invite link' }))
    await user.click(screen.getByRole('tab', { name: 'Multiple people' }))
    await user.click(screen.getByRole('combobox', { name: 'Join limit' }))
    await user.click(screen.getByRole('option', { name: '10 joins' }))
    await user.click(
      screen.getByRole('button', { name: 'Generate invite link' }),
    )

    await waitFor(() =>
      expect(
        screen.getByText(/Up to 10 members can join with it/i),
      ).toBeInTheDocument(),
    )
  })

  it('uses the unlimited intro variant for uncapped links', async () => {
    const onGenerateSharedLink = vi.fn().mockResolvedValue({
      inviteUrl: sharedInviteUrl,
      role: 'MEMBER',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      maxUses: null,
      label: null,
      isShared: true,
    })
    const { user } = renderCard({ onGenerateSharedLink })

    await user.click(screen.getByRole('tab', { name: 'Invite link' }))
    await user.click(screen.getByRole('tab', { name: 'Multiple people' }))
    await user.click(
      screen.getByRole('button', { name: 'Generate invite link' }),
    )

    await waitFor(() =>
      expect(
        screen.getByText(/New members can join with it/i),
      ).toBeInTheDocument(),
    )
  })

  it('routes one-time creation through the one-time path in One person mode', async () => {
    const onGenerateLink = vi.fn().mockResolvedValue(undefined)
    const onGenerateSharedLink = vi.fn().mockResolvedValue(undefined)
    const { user } = renderCard({ onGenerateLink, onGenerateSharedLink })

    await user.click(screen.getByRole('tab', { name: 'Invite link' }))
    await user.click(
      screen.getByRole('button', { name: 'Generate invite link' }),
    )

    await waitFor(() => expect(onGenerateLink).toHaveBeenCalledOnce())
    expect(onGenerateSharedLink).not.toHaveBeenCalled()
  })
})
