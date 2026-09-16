import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen, waitFor } from '@/test/test-utils'

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
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    invitations: {
      revoke: {
        useMutation: (options?: {
          onSuccess?: (data: unknown, vars: unknown) => void | Promise<void>
        }) => ({
          mutate: mocks.revokeMutate,
          mutateAsync: async (args: unknown) => {
            const result = await mocks.revokeMutateAsync(args)
            await options?.onSuccess?.(result, args)
            return result
          },
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
    recentJoiners: [],
    canRevoke: true,
    canManage: true,
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
    await waitFor(() =>
      expect(mocks.revokeMutateAsync).toHaveBeenCalledWith({
        invitationId: 'inv-1',
      }),
    )
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
    await waitFor(() => expect(onQrSessionInvalidated).toHaveBeenCalledOnce())
  })
})
