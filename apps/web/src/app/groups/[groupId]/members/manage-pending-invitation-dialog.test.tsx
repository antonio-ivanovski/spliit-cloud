import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen, waitFor } from '@/test/test-utils'

import { ManagePendingInvitationDialog } from './manage-pending-invitation-dialog'
import type { PendingInvitation } from './members-hooks'
import { PendingInvitationsCard } from './pending-invitations-card'

vi.mock(import('@/lib/hooks'), async (importActual) => {
  const actual = await importActual()
  return { ...actual, useMediaQuery: () => true }
})

const friendsState = vi.hoisted(() => ({
  friends: [] as Array<{
    accountId: string
    name: string
    email: string
    image?: string | null
    sharedGroupCount: number
    isMember: boolean
    isPendingInvite: boolean
  }>,
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    account: {
      friends: {
        useQuery: () => ({
          data: { friends: friendsState.friends },
          isLoading: false,
        }),
      },
    },
  },
}))

const mocks = vi.hoisted(() => ({
  updateMutate: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

function makeInvitation(
  overrides: Partial<PendingInvitation> = {},
): PendingInvitation {
  return {
    id: 'inv-1',
    groupId: 'grp-1',
    type: 'EMAIL',
    email: 'bob@example.com',
    temporaryName: null,
    role: 'MEMBER',
    status: 'PENDING',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    expiresAt: null,
    ledgerParticipantId: 'lp-1',
    canRevoke: true,
    canManage: true,
    recipientProfile: null,
    ...overrides,
  }
}

function makeUpdateState(overrides: Record<string, unknown> = {}) {
  return {
    mutateAsync: mocks.updateMutate,
    isPending: false,
    ...overrides,
  }
}

function renderDialog(
  invitation: PendingInvitation | null,
  overrides: {
    isAdmin?: boolean
    update?: ReturnType<typeof makeUpdateState>
  } = {},
) {
  const onOpenChange = vi.fn()
  const { user } = render(
    <ManagePendingInvitationDialog
      invitation={invitation}
      groupName="Roadtrip 2026"
      isAdmin={overrides.isAdmin ?? true}
      updatePending={overrides.update ?? makeUpdateState()}
      onOpenChange={onOpenChange}
    />,
  )
  return { user, onOpenChange }
}

describe('ManagePendingInvitationDialog', () => {
  it('opens in edit view with email form for an EMAIL invitation', () => {
    renderDialog(makeInvitation())
    expect(
      screen.getByRole('heading', { name: 'Manage invitation' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('textbox', { name: 'Email address' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Save changes' }),
    ).toBeInTheDocument()
    // Admins see the role picker.
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('switches the delivery to LINK via the link tab and relabels the footer', async () => {
    const { user } = renderDialog(makeInvitation())
    await user.click(screen.getByRole('tab', { name: 'Invite link' }))
    expect(
      screen.getByRole('button', { name: 'Switch & generate link' }),
    ).toBeInTheDocument()
  })

  it('labels the save button Update & send and warns when the email changes', async () => {
    const { user } = renderDialog(makeInvitation())
    const emailInput = screen.getByRole('textbox', {
      name: 'Email address',
    })
    await user.clear(emailInput)
    await user.type(emailInput, 'carol@example.com')
    expect(
      screen.getByRole('button', { name: 'Update & send' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/current recipient won't be able to accept/i),
    ).toBeInTheDocument()
  })

  it('disables Save until the form is dirty', () => {
    renderDialog(makeInvitation())
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })

  it('closes the dialog after a successful metadata-only save', async () => {
    mocks.updateMutate.mockResolvedValue({
      invitation: makeInvitation({ temporaryName: 'Bobby' }),
      inviteUrl: null,
    })
    const { user, onOpenChange } = renderDialog(makeInvitation())
    const nameInput = screen.getByRole('textbox', {
      name: 'Display name',
    })
    await user.clear(nameInput)
    await user.type(nameInput, 'Bobby')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(mocks.updateMutate).toHaveBeenCalledWith({
        invitationId: 'inv-1',
        role: 'MEMBER',
        temporaryName: 'Bobby',
        delivery: { type: 'EMAIL', email: 'bob@example.com' },
      })
    })
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('shows a one-time link result view after EMAIL -> LINK conversion', async () => {
    mocks.updateMutate.mockResolvedValue({
      invitation: makeInvitation({
        type: 'LINK',
        email: 'abc@link.placeholder.local',
        expiresAt: new Date('2026-02-01T00:00:00Z'),
      }),
      inviteUrl: 'http://localhost:3000/groups/grp-1?invite=abc123',
    })
    const { user } = renderDialog(makeInvitation())
    await user.click(screen.getByRole('tab', { name: 'Invite link' }))
    await user.click(
      screen.getByRole('button', { name: 'Switch & generate link' }),
    )

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'New link ready' }),
      ).toBeInTheDocument()
    })
    expect(
      screen.getByDisplayValue(
        'http://localhost:3000/groups/grp-1?invite=abc123',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/won't be able to view it again/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
  })

  it('shows an inline error when the save fails and stays in edit view', async () => {
    mocks.updateMutate.mockRejectedValue(
      new Error('An invitation is already pending for this email.'),
    )
    const { user } = renderDialog(makeInvitation())
    const emailInput = screen.getByRole('textbox', {
      name: 'Email address',
    })
    await user.clear(emailInput)
    await user.type(emailInput, 'carol@example.com')
    await user.click(screen.getByRole('button', { name: 'Update & send' }))

    await waitFor(() => {
      expect(
        screen.getByText(/An invitation is already pending for this email/i),
      ).toBeInTheDocument()
    })
    // The dialog stays open with the form.
    expect(
      screen.getByRole('heading', { name: 'Manage invitation' }),
    ).toBeInTheDocument()
  })

  it('rejects an invalid email inline with a translated message without calling the API', async () => {
    const { user } = renderDialog(makeInvitation())
    const emailInput = screen.getByRole('textbox', {
      name: 'Email address',
    })
    await user.clear(emailInput)
    await user.type(emailInput, 'not-an-email')
    await user.click(screen.getByRole('button', { name: 'Update & send' }))

    expect(mocks.updateMutate).not.toHaveBeenCalled()
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument()
  })

  it('explains that the invite link is not shown for link invitations', () => {
    renderDialog(
      makeInvitation({ type: 'LINK', email: 'abc@link.placeholder.local' }),
    )
    expect(
      screen.getByText(/invite link is not shown here/i),
    ).toBeInTheDocument()
  })

  it('locks the display name to the account profile when matched', () => {
    renderDialog(
      makeInvitation({
        recipientProfile: {
          id: 'acct-bob',
          name: 'Bob Profile',
          image: null,
        },
      }),
    )
    expect(screen.getAllByText('Bob Profile').length).toBeGreaterThan(0)
    expect(
      screen.getByText(/Uses their Spliit profile name/i),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('textbox', { name: 'Display name' }),
    ).not.toBeInTheDocument()
  })

  it('hides the role control entirely for non-admin managers', () => {
    renderDialog(makeInvitation(), { isAdmin: false })
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByText('Member')).not.toBeInTheDocument()
  })

  it('applies a selected friend as the EMAIL delivery target', async () => {
    friendsState.friends = [
      {
        accountId: 'acct-carol',
        name: 'Carol',
        email: 'carol@example.com',
        image: null,
        sharedGroupCount: 1,
        isMember: false,
        isPendingInvite: false,
      },
    ]
    mocks.updateMutate.mockResolvedValue({
      invitation: makeInvitation({ email: 'carol@example.com' }),
      inviteUrl: null,
    })
    const { user, onOpenChange } = renderDialog(makeInvitation())
    await user.click(screen.getByRole('tab', { name: 'Friends' }))
    await user.click(screen.getByRole('combobox', { name: /select a friend/i }))
    await user.click(screen.getByRole('option', { name: /Carol/ }))

    // Selecting the friend targets the form at their email + profile
    // name and enables the footer Save.
    await user.click(screen.getByRole('button', { name: 'Update & send' }))

    await waitFor(() => {
      expect(mocks.updateMutate).toHaveBeenCalledWith({
        invitationId: 'inv-1',
        role: 'MEMBER',
        temporaryName: 'Carol',
        delivery: { type: 'EMAIL', email: 'carol@example.com' },
      })
    })
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('keeps the managed invitee selectable while other pending friends stay disabled', async () => {
    friendsState.friends = [
      {
        accountId: 'acct-bob',
        name: 'Bob',
        email: 'bob@example.com',
        image: null,
        sharedGroupCount: 1,
        isMember: false,
        isPendingInvite: true,
      },
      {
        accountId: 'acct-dave',
        name: 'Dave',
        email: 'dave@example.com',
        image: null,
        sharedGroupCount: 1,
        isMember: false,
        isPendingInvite: true,
      },
    ]
    const { user } = renderDialog(makeInvitation())
    await user.click(screen.getByRole('tab', { name: 'Friends' }))
    await user.click(screen.getByRole('combobox', { name: /select a friend/i }))

    // Dave has a pending invite to another email, so he stays disabled;
    // Bob is the invitation being managed and must be selectable.
    expect(screen.getByRole('option', { name: /Dave/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    const bobOption = screen.getByRole('option', { name: /Bob/ })
    expect(bobOption).not.toHaveAttribute('aria-disabled')

    await user.click(bobOption)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => {
      expect(mocks.updateMutate).toHaveBeenCalledWith({
        invitationId: 'inv-1',
        role: 'MEMBER',
        temporaryName: 'Bob',
        delivery: { type: 'EMAIL', email: 'bob@example.com' },
      })
    })
  })

  it('shows the email validation error inside the friends tab', async () => {
    // A LINK invitation has no email address; switching to the
    // friends tab makes the delivery EMAIL without a target.
    const { user } = renderDialog(
      makeInvitation({ type: 'LINK', email: 'abc@link.placeholder.local' }),
    )
    await user.click(screen.getByRole('tab', { name: 'Friends' }))
    await user.click(
      screen.getByRole('button', { name: 'Switch & send invitation' }),
    )

    expect(mocks.updateMutate).not.toHaveBeenCalled()
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument()
  })
})

describe('PendingInvitationsCard', () => {
  const cardProps = {
    isLoading: false,
    onManage: vi.fn(),
    onManageButtonRef: vi.fn(),
    onGenerateLink: vi.fn(),
    onGenerateButtonRef: vi.fn(),
    onRevoke: vi.fn(),
    locale: 'en-US',
    timeZone: 'UTC',
  }

  it('renders rows with delivery and role badges and a Manage button', () => {
    render(
      <PendingInvitationsCard
        {...cardProps}
        invitations={[
          makeInvitation({
            id: 'inv-1',
            type: 'EMAIL',
            email: 'bob@example.com',
            role: 'ADMIN',
          }),
          makeInvitation({
            id: 'inv-2',
            type: 'LINK',
            email: 'abc@link.placeholder.local',
            temporaryName: 'Guest',
            role: 'MEMBER',
          }),
        ]}
      />,
    )
    expect(screen.getByText('bob@example.com')).toBeInTheDocument()
    expect(screen.getByText('Email invite')).toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.getByText('Guest')).toBeInTheDocument()
    expect(screen.getByText('Anyone with the link')).toBeInTheDocument()
    expect(screen.getByText('Single-use link')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Manage' })).toHaveLength(2)
  })

  it('shows Generate new link only for link invitations the caller can manage', () => {
    render(
      <PendingInvitationsCard
        {...cardProps}
        invitations={[
          makeInvitation({
            id: 'inv-email',
            type: 'EMAIL',
            email: 'bob@example.com',
          }),
          makeInvitation({
            id: 'inv-link',
            type: 'LINK',
            email: 'abc@link.placeholder.local',
          }),
          makeInvitation({
            id: 'inv-link-nomanage',
            type: 'LINK',
            email: 'def@link.placeholder.local',
            canManage: false,
          }),
        ]}
      />,
    )
    expect(
      screen.getAllByRole('button', { name: 'Generate new link' }),
    ).toHaveLength(1)
    expect(
      screen.getByRole('button', { name: 'Generate new link' }),
    ).toBeEnabled()
  })

  it('shows a destructive Revoke button only when revoking is possible', () => {
    render(
      <PendingInvitationsCard
        {...cardProps}
        invitations={[
          makeInvitation({
            id: 'inv-revocable',
            canRevoke: true,
          }),
          makeInvitation({
            id: 'inv-not-revocable',
            canRevoke: false,
          }),
          makeInvitation({
            id: 'inv-no-participant',
            canRevoke: true,
            ledgerParticipantId: null,
          }),
        ]}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Revoke invitation' }),
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: 'Revoke invitation' }),
    ).toHaveLength(1)
  })

  it('forwards revoke with the ledger participant id and label', async () => {
    const onRevoke = vi.fn()
    const { user } = render(
      <PendingInvitationsCard
        {...cardProps}
        onRevoke={onRevoke}
        invitations={[makeInvitation({ temporaryName: 'Carol' })]}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Revoke invitation' }))
    expect(onRevoke).toHaveBeenCalledWith({
      ledgerParticipantId: 'lp-1',
      label: 'Carol',
    })
  })

  it('uses the matched account profile for the avatar and name', () => {
    render(
      <PendingInvitationsCard
        {...cardProps}
        invitations={[
          makeInvitation({
            recipientProfile: {
              id: 'acct-bob',
              name: 'Bob Profile',
              image: null,
            },
          }),
        ]}
      />,
    )
    expect(screen.getByText('Bob Profile')).toBeInTheDocument()
    // Initials fallback derived from the profile name.
    expect(screen.getByText('BP')).toBeInTheDocument()
  })

  it('falls back to initials from the invitation label without a profile', () => {
    render(
      <PendingInvitationsCard
        {...cardProps}
        invitations={[makeInvitation({ temporaryName: 'Carol' })]}
      />,
    )
    expect(screen.getByText('C')).toBeInTheDocument()
  })

  it('hides the Manage button when the caller cannot manage', () => {
    render(
      <PendingInvitationsCard
        {...cardProps}
        invitations={[makeInvitation({ canManage: false })]}
      />,
    )
    expect(
      screen.queryByRole('button', { name: 'Manage' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Generate new link' }),
    ).not.toBeInTheDocument()
  })

  it('renders loading skeletons instead of rows', () => {
    const { container } = render(
      <PendingInvitationsCard {...cardProps} isLoading invitations={[]} />,
    )
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(
      0,
    )
    expect(screen.queryByRole('button', { name: 'Manage' })).toBeNull()
  })
})
