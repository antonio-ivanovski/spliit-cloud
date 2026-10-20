import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen, waitFor, within } from '@/test/test-utils'

import type { PendingInvitation } from './members-hooks'
import { PendingInvitationsCard } from './pending-invitations-card'

const mocks = vi.hoisted(() => ({
  onManage: vi.fn(),
  onGenerateLink: vi.fn(),
  onRevoke: vi.fn(),
  onViewQr: vi.fn(),
  revokeMutateAsync: vi.fn(),
  revokeMutate: vi.fn(),
  onQrSessionInvalidated: vi.fn(),
  getLinkUrlMutateAsync: vi.fn(),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    invitations: {
      revoke: {
        useMutation: (options?: {
          onSuccess?: (data: unknown, vars: unknown) => void | Promise<void>
        }) => ({
          mutate: (args: unknown) => {
            mocks.revokeMutate(args)
            void (async () => {
              const result = await mocks.revokeMutateAsync(args)
              await options?.onSuccess?.(result, args)
            })()
          },
          mutateAsync: async (args: unknown) => {
            const result = await mocks.revokeMutateAsync(args)
            await options?.onSuccess?.(result, args)
            return result
          },
          isPending: false,
        }),
      },
      getLinkUrl: {
        useMutation: () => ({
          mutateAsync: mocks.getLinkUrlMutateAsync,
          isPending: false,
        }),
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
  vi.restoreAllMocks()
  vi.clearAllMocks()
  mocks.revokeMutateAsync.mockResolvedValue({})
})

function mockViewport(desktop: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: desktop,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }))
}

function makeInvitation(
  overrides: Partial<PendingInvitation> = {},
): PendingInvitation {
  return {
    id: 'inv-1',
    groupId: 'grp-1',
    type: 'LINK',
    email: 'link@placeholder.local',
    temporaryName: 'Roommate',
    role: 'MEMBER',
    status: 'PENDING',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    expiresAt: new Date('2026-02-01T00:00:00Z'),
    ledgerParticipantId: 'lp-1',
    isMultiUse: false,
    useCount: 0,
    maxUses: null,
    label: null,
    isShared: false,
    endedReason: null,
    recentJoiners: [],
    canRevoke: true,
    canManage: true,
    canCopyLink: false,
    recipientProfile: null,
    ...overrides,
  }
}

describe('PendingInvitationsCard row actions', () => {
  it('keeps all pending actions icon-only and accessible', async () => {
    mockViewport(true)
    const { user } = render(
      <PendingInvitationsCard
        invitations={[makeInvitation()]}
        isLoading={false}
        onManage={mocks.onManage}
        onManageButtonRef={vi.fn()}
        onGenerateLink={mocks.onGenerateLink}
        onGenerateButtonRef={vi.fn()}
        onRevoke={mocks.onRevoke}
        onViewQr={mocks.onViewQr}
        activeQrSessionId={null}
        onQrSessionInvalidated={mocks.onQrSessionInvalidated}
        locale="en-US"
        timeZone="UTC"
      />,
    )

    const manageButton = screen.getByRole('button', { name: 'Manage' })
    const regenerateButton = screen.getByRole('button', {
      name: 'Generate new link',
    })
    const revokeButton = screen.getByRole('button', {
      name: 'Revoke invitation',
    })

    expect(manageButton).toHaveAttribute('title', 'Manage')
    expect(regenerateButton).toHaveAttribute('title', 'Generate new link')
    expect(revokeButton).toHaveAttribute('title', 'Revoke invitation')
    expect(screen.queryByText('Manage')).not.toBeInTheDocument()
    expect(screen.queryByText('Generate new link')).not.toBeInTheDocument()
    expect(screen.queryByText('Revoke invitation')).not.toBeInTheDocument()

    await user.click(manageButton)
    await user.click(regenerateButton)
    await user.click(revokeButton)

    expect(mocks.onManage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'inv-1' }),
    )
    expect(mocks.onGenerateLink).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'inv-1' }),
    )
    expect(mocks.onRevoke).toHaveBeenCalledWith({
      ledgerParticipantId: 'lp-1',
      label: 'Roommate',
    })
  })

  it('uses one mobile More button with labeled permitted actions', async () => {
    mockViewport(false)
    let manageFocusTarget: HTMLButtonElement | null = null
    let regenerateFocusTarget: HTMLButtonElement | null = null
    const { user } = render(
      <PendingInvitationsCard
        invitations={[makeInvitation()]}
        isLoading={false}
        onManage={mocks.onManage}
        onManageButtonRef={(_, element) => {
          manageFocusTarget = element
        }}
        onGenerateLink={mocks.onGenerateLink}
        onGenerateButtonRef={(_, element) => {
          regenerateFocusTarget = element
        }}
        onRevoke={mocks.onRevoke}
        onViewQr={mocks.onViewQr}
        activeQrSessionId={null}
        onQrSessionInvalidated={mocks.onQrSessionInvalidated}
        locale="en-US"
        timeZone="UTC"
      />,
    )

    expect(screen.queryByText(/Updated /)).not.toBeInTheDocument()
    expect(screen.getByText(/Link expires/)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Manage' }),
    ).not.toBeInTheDocument()

    const moreButton = screen.getByRole('button', {
      name: 'Actions for Roommate',
    })
    expect(manageFocusTarget).toBe(moreButton)
    expect(regenerateFocusTarget).toBe(moreButton)

    await user.click(moreButton)
    expect(
      screen.getByRole('heading', { name: 'Actions for Roommate' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Manage' }))
    await waitFor(() =>
      expect(mocks.onManage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'inv-1' }),
      ),
    )
    await waitFor(() => expect(moreButton).toHaveFocus())

    await user.click(moreButton)
    await user.click(screen.getByRole('button', { name: 'Generate new link' }))
    await waitFor(() =>
      expect(mocks.onGenerateLink).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'inv-1' }),
      ),
    )

    await user.click(moreButton)
    await user.click(screen.getByRole('button', { name: 'Revoke invitation' }))
    await waitFor(() =>
      expect(mocks.onRevoke).toHaveBeenCalledWith({
        ledgerParticipantId: 'lp-1',
        label: 'Roommate',
      }),
    )
  })

  it('does not show a mobile action trigger without any permission', () => {
    mockViewport(false)
    render(
      <PendingInvitationsCard
        invitations={[
          makeInvitation({
            canManage: false,
            canRevoke: false,
          }),
        ]}
        isLoading={false}
        onManage={mocks.onManage}
        onManageButtonRef={vi.fn()}
        onGenerateLink={mocks.onGenerateLink}
        onGenerateButtonRef={vi.fn()}
        onRevoke={mocks.onRevoke}
        onViewQr={mocks.onViewQr}
        activeQrSessionId={null}
        onQrSessionInvalidated={mocks.onQrSessionInvalidated}
        locale="en-US"
        timeZone="UTC"
      />,
    )

    expect(
      screen.queryByRole('button', { name: 'Actions for Roommate' }),
    ).not.toBeInTheDocument()
  })

  it('labels a QR session row with its join count and joiner names', () => {
    mockViewport(true)
    render(
      <PendingInvitationsCard
        invitations={[
          makeInvitation({
            temporaryName: null,
            ledgerParticipantId: null,
            isMultiUse: true,
            useCount: 2,
            recentJoiners: [
              {
                accountId: 'acct-alice',
                name: 'Alice',
                image: null,
                joinedAt: new Date('2026-09-16T10:00:00Z'),
              },
              {
                accountId: 'acct-bob',
                name: 'Bob',
                image: null,
                joinedAt: new Date('2026-09-16T10:01:00Z'),
              },
            ],
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          }),
        ]}
        isLoading={false}
        onManage={mocks.onManage}
        onManageButtonRef={vi.fn()}
        onGenerateLink={mocks.onGenerateLink}
        onGenerateButtonRef={vi.fn()}
        onRevoke={mocks.onRevoke}
        onViewQr={mocks.onViewQr}
        activeQrSessionId={null}
        onQrSessionInvalidated={mocks.onQrSessionInvalidated}
        locale="en-US"
        timeZone="UTC"
      />,
    )

    expect(screen.getByText('QR session')).toBeInTheDocument()
    expect(screen.getByText('Nearby QR code')).toBeInTheDocument()
    expect(screen.getByText(/2 people joined/)).toBeInTheDocument()
    expect(screen.getByText(/Alice, Bob/)).toBeInTheDocument()
    // QR rows never offer the single-use link actions.
    expect(
      screen.queryByRole('button', { name: 'Generate new link' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Manage' }),
    ).not.toBeInTheDocument()
  })

  it('hides expired QR sessions from the pending list', () => {
    mockViewport(true)
    render(
      <PendingInvitationsCard
        invitations={[
          makeInvitation({
            id: 'inv-qr-expired',
            temporaryName: null,
            ledgerParticipantId: null,
            isMultiUse: true,
            useCount: 3,
            recentJoiners: [],
            expiresAt: new Date(Date.now() - 60 * 1000),
          }),
        ]}
        isLoading={false}
        onManage={mocks.onManage}
        onManageButtonRef={vi.fn()}
        onGenerateLink={mocks.onGenerateLink}
        onGenerateButtonRef={vi.fn()}
        onRevoke={mocks.onRevoke}
        onViewQr={mocks.onViewQr}
        activeQrSessionId={null}
        onQrSessionInvalidated={mocks.onQrSessionInvalidated}
        locale="en-US"
        timeZone="UTC"
      />,
    )

    expect(screen.queryByText('QR session')).not.toBeInTheDocument()
    expect(screen.getByText('No pending invitations.')).toBeInTheDocument()
  })

  it('opens the QR tab from a QR row via View QR code', async () => {
    mockViewport(true)
    const { user } = render(
      <PendingInvitationsCard
        invitations={[
          makeInvitation({
            temporaryName: null,
            ledgerParticipantId: null,
            isMultiUse: true,
            useCount: 1,
            recentJoiners: [],
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          }),
        ]}
        isLoading={false}
        onManage={mocks.onManage}
        onManageButtonRef={vi.fn()}
        onGenerateLink={mocks.onGenerateLink}
        onGenerateButtonRef={vi.fn()}
        onRevoke={mocks.onRevoke}
        onViewQr={mocks.onViewQr}
        activeQrSessionId={null}
        onQrSessionInvalidated={mocks.onQrSessionInvalidated}
        locale="en-US"
        timeZone="UTC"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'View QR code' }))
    expect(mocks.onViewQr).toHaveBeenCalledOnce()
    expect(mocks.onRevoke).not.toHaveBeenCalled()
  })

  it('expires a QR session directly without a ledger participant', async () => {
    mockViewport(true)
    const { user } = render(
      <PendingInvitationsCard
        invitations={[
          makeInvitation({
            temporaryName: null,
            ledgerParticipantId: null,
            isMultiUse: true,
            useCount: 1,
            recentJoiners: [],
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          }),
        ]}
        isLoading={false}
        onManage={mocks.onManage}
        onManageButtonRef={vi.fn()}
        onGenerateLink={mocks.onGenerateLink}
        onGenerateButtonRef={vi.fn()}
        onRevoke={mocks.onRevoke}
        onViewQr={mocks.onViewQr}
        activeQrSessionId={null}
        onQrSessionInvalidated={mocks.onQrSessionInvalidated}
        locale="en-US"
        timeZone="UTC"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Expire now' }))

    // The destructive action waits behind the standard confirmation dialog.
    expect(
      screen.getByRole('heading', { name: 'Expire this QR code?' }),
    ).toBeInTheDocument()
    expect(mocks.revokeMutateAsync).not.toHaveBeenCalled()

    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Expire now',
      }),
    )
    await waitFor(() =>
      expect(mocks.revokeMutateAsync).toHaveBeenCalledWith({
        invitationId: 'inv-1',
      }),
    )
  })

  it('cancelling the QR expire dialog fires no mutation', async () => {
    mockViewport(true)
    const { user } = render(
      <PendingInvitationsCard
        invitations={[
          makeInvitation({
            temporaryName: null,
            ledgerParticipantId: null,
            isMultiUse: true,
            useCount: 1,
            recentJoiners: [],
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          }),
        ]}
        isLoading={false}
        onManage={mocks.onManage}
        onManageButtonRef={vi.fn()}
        onGenerateLink={mocks.onGenerateLink}
        onGenerateButtonRef={vi.fn()}
        onRevoke={mocks.onRevoke}
        onViewQr={mocks.onViewQr}
        activeQrSessionId={null}
        onQrSessionInvalidated={mocks.onQrSessionInvalidated}
        locale="en-US"
        timeZone="UTC"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Expire now' }))
    expect(
      screen.getByRole('heading', { name: 'Expire this QR code?' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Expire this QR code?' }),
      ).not.toBeInTheDocument(),
    )
    expect(mocks.revokeMutate).not.toHaveBeenCalled()
    expect(mocks.revokeMutateAsync).not.toHaveBeenCalled()
  })

  it('clears the displayed QR code when its own session is expired', async () => {
    mockViewport(true)
    const onQrSessionInvalidated = vi.fn()
    const { user } = render(
      <PendingInvitationsCard
        invitations={[
          makeInvitation({
            temporaryName: null,
            ledgerParticipantId: null,
            isMultiUse: true,
            useCount: 1,
            recentJoiners: [],
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          }),
        ]}
        isLoading={false}
        onManage={mocks.onManage}
        onManageButtonRef={vi.fn()}
        onGenerateLink={mocks.onGenerateLink}
        onGenerateButtonRef={vi.fn()}
        onRevoke={mocks.onRevoke}
        onViewQr={mocks.onViewQr}
        activeQrSessionId="inv-1"
        onQrSessionInvalidated={onQrSessionInvalidated}
        locale="en-US"
        timeZone="UTC"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Expire now' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Expire now',
      }),
    )
    await waitFor(() => expect(onQrSessionInvalidated).toHaveBeenCalledOnce())
  })
})

describe('PendingInvitationsCard shared links', () => {
  function makeSharedInvitation(
    overrides: Partial<PendingInvitation> = {},
  ): PendingInvitation {
    return makeInvitation({
      temporaryName: null,
      ledgerParticipantId: null,
      isMultiUse: true,
      isShared: true,
      useCount: 3,
      maxUses: 10,
      label: 'Family chat',
      endedReason: null,
      canCopyLink: true,
      recentJoiners: [
        {
          accountId: 'acct-alice',
          name: 'Alice',
          image: null,
          joinedAt: new Date('2026-09-16T10:00:00Z'),
        },
      ],
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ...overrides,
    })
  }

  function renderShared(invitation: PendingInvitation) {
    mockViewport(true)
    return render(
      <PendingInvitationsCard
        invitations={[invitation]}
        isLoading={false}
        onManage={mocks.onManage}
        onManageButtonRef={vi.fn()}
        onGenerateLink={mocks.onGenerateLink}
        onGenerateButtonRef={vi.fn()}
        onRevoke={mocks.onRevoke}
        onViewQr={mocks.onViewQr}
        activeQrSessionId={null}
        onQrSessionInvalidated={mocks.onQrSessionInvalidated}
        locale="en-US"
        timeZone="UTC"
      />,
    )
  }

  it('labels a shared row with its label, badge, and join count', () => {
    renderShared(makeSharedInvitation())

    expect(screen.getByText('Family chat')).toBeInTheDocument()
    expect(screen.getByText('Shared link')).toBeInTheDocument()
    // The expiry line carries the accepted count with it.
    expect(screen.getByText(/Expires .* · 3 of 10 joined/)).toBeInTheDocument()
    // A shared row is not a QR row: no QR-only actions.
    expect(
      screen.queryByRole('button', { name: 'View QR code' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Expire now' }),
    ).not.toBeInTheDocument()
  })

  it('shows the join count with the expiry for unlimited links', () => {
    renderShared(makeSharedInvitation({ maxUses: null }))

    expect(screen.getByText(/Expires .* · 3 joined/)).toBeInTheDocument()
  })

  it('shows the exact expiry datetime on shared rows', () => {
    renderShared(
      makeSharedInvitation({ expiresAt: new Date('2026-10-26T14:30:00Z') }),
    )

    // Date + time, not just the day: the moment the link dies.
    expect(
      screen.getByText(/Expires Oct 26, 2026, 2:30 PM · 3 of 10 joined/),
    ).toBeInTheDocument()
  })

  it('copies the live URL through the dedicated mutation', async () => {
    mocks.getLinkUrlMutateAsync.mockResolvedValue({
      inviteUrl: 'https://spliit.example/groups/grp-1?invite=sharedtoken12345',
      expiresAt: new Date(),
      useCount: 3,
      maxUses: 10,
      label: 'Family chat',
    })
    const { user } = renderShared(makeSharedInvitation())
    // Spy after render: user-event setup replaces navigator.clipboard, so
    // an earlier spy would watch a discarded object.
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined)

    await user.click(screen.getByRole('button', { name: 'Copy link' }))

    await waitFor(() =>
      expect(mocks.getLinkUrlMutateAsync).toHaveBeenCalledWith({
        groupId: 'grp-1',
        invitationId: 'inv-1',
      }),
    )
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        'https://spliit.example/groups/grp-1?invite=sharedtoken12345',
      ),
    )
  })

  it('shows a Full badge and hides copy once the cap is reached', () => {
    renderShared(
      makeSharedInvitation({
        useCount: 10,
        endedReason: 'full',
        canCopyLink: false,
      }),
    )

    expect(screen.getByText('Full')).toBeInTheDocument()
    expect(screen.getByText(/10 of 10 joined/)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Copy link' }),
    ).not.toBeInTheDocument()
    // Ended links stay listed so they can be revived or cleaned up.
    expect(screen.getByText('Family chat')).toBeInTheDocument()
  })

  it('shows an Expired badge from the server reason even with a future clock', () => {
    // The badge follows `endedReason`, not a client recomputation: a row
    // the server marks expired stays expired here.
    renderShared(
      makeSharedInvitation({
        endedReason: 'expired',
        canCopyLink: false,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }),
    )

    expect(screen.getByText('Expired')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Copy link' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Family chat')).toBeInTheDocument()
  })

  it('asks for confirmation before revoking a shared link', async () => {
    const { user } = renderShared(makeSharedInvitation())

    await user.click(screen.getByRole('button', { name: 'Revoke invitation' }))

    expect(
      screen.getByRole('heading', { name: 'Revoke shared link?' }),
    ).toBeInTheDocument()
    expect(mocks.revokeMutate).not.toHaveBeenCalled()
    expect(mocks.revokeMutateAsync).not.toHaveBeenCalled()

    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Revoke',
      }),
    )
    await waitFor(() =>
      expect(mocks.revokeMutateAsync).toHaveBeenCalledWith({
        invitationId: 'inv-1',
      }),
    )
    // The participant-based revoke dialog is never involved.
    expect(mocks.onRevoke).not.toHaveBeenCalled()
  })

  it('cancelling the shared revoke dialog fires no mutation', async () => {
    const { user } = renderShared(makeSharedInvitation())

    await user.click(screen.getByRole('button', { name: 'Revoke invitation' }))
    expect(
      screen.getByRole('heading', { name: 'Revoke shared link?' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Revoke shared link?' }),
      ).not.toBeInTheDocument(),
    )
    expect(mocks.revokeMutate).not.toHaveBeenCalled()
    expect(mocks.revokeMutateAsync).not.toHaveBeenCalled()
  })

  it('opens edit and regenerate through the manage callbacks', async () => {
    const { user } = renderShared(makeSharedInvitation())

    await user.click(screen.getByRole('button', { name: 'Edit link' }))
    expect(mocks.onManage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'inv-1' }),
    )

    await user.click(screen.getByRole('button', { name: 'Generate new link' }))
    expect(mocks.onGenerateLink).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'inv-1' }),
    )
  })

  it('opens the joiner list from the row', async () => {
    const { user } = renderShared(makeSharedInvitation())

    await user.click(screen.getByRole('button', { name: 'Who joined' }))

    expect(screen.getByText('Alice')).toBeInTheDocument()
  })
})
