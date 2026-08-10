import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen, waitFor } from '@/test/test-utils'

import type { PendingInvitation } from './members-hooks'
import { PendingInvitationsCard } from './pending-invitations-card'

const mocks = vi.hoisted(() => ({
  onManage: vi.fn(),
  onGenerateLink: vi.fn(),
  onRevoke: vi.fn(),
}))

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
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
        locale="en-US"
        timeZone="UTC"
      />,
    )

    expect(
      screen.queryByRole('button', { name: 'Actions for Roommate' }),
    ).not.toBeInTheDocument()
  })
})
