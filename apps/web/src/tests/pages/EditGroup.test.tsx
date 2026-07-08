import { render, screen } from '@/test/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mockUseCurrentGroup: vi.fn(),
  mockUseIsPendingInvitee: vi.fn(() => false),
}))

vi.mock('@/app/groups/[groupId]/current-group-context', () => ({
  useCurrentGroup: mocks.mockUseCurrentGroup,
  useIsPendingInvitee: mocks.mockUseIsPendingInvitee,
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    groups: {
      getDetails: {
        useQuery: vi.fn(() => ({ data: null, isLoading: false })),
      },
      update: { useMutation: vi.fn(() => ({ mutateAsync: vi.fn() })) },
      archive: { useMutation: vi.fn(() => ({ mutateAsync: vi.fn() })) },
      delete: { useMutation: vi.fn(() => ({ mutateAsync: vi.fn() })) },
    },
    useUtils: () => ({ groups: { invalidate: vi.fn() } }),
  },
}))

vi.mock('@/app/groups/[groupId]/edit/edit-group-mutations', () => ({
  useUpdateGroupMutation: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useArchiveGroupMutation: vi.fn(() => ({ isPending: false, mutate: vi.fn() })),
  useDeleteGroupMutation: vi.fn(() => ({ isPending: false, mutate: vi.fn() })),
}))

vi.mock('@/components/group-form', () => ({
  GroupForm: (props: { nameReadOnly?: boolean }) => (
    <div
      data-testid="group-form"
      data-name-readonly={String(props.nameReadOnly)}
    >
      GroupForm
    </div>
  ),
}))

vi.mock('@/app/groups/[groupId]/use-link-invite-token', () => ({
  useLinkInviteToken: vi.fn(() => undefined),
}))

vi.mock('@/components/link', () => ({
  default: ({
    href,
    children,
  }: {
    href: string
    children: React.ReactNode
  }) => <a href={href}>{children}</a>,
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('@/components/force-archive-dialog', () => ({
  ForceArchiveDialog: () => null,
}))

vi.mock('@/app/groups/[groupId]/edit/delete-group-dialog', () => ({
  DeleteGroupDialog: () => null,
}))

import { EditGroup } from '@/app/groups/[groupId]/edit/edit-group'

function setFriendGroup() {
  mocks.mockUseCurrentGroup.mockReturnValue({
    isLoading: false,
    groupId: 'group-1',
    group: {
      id: 'group-1',
      name: 'fri-ledger-xyz',
      archived: false,
      currency: '€',
      currencyCode: 'EUR',
      groupType: 'FRIEND',
      friendPairKey: 'k1',
      participants: [
        { id: 'lp1', name: 'Alice', pending: false, unlinked: false },
        { id: 'lp2', name: 'Bob', pending: false, unlinked: false },
      ],
    },
    displayName: 'Alice & Bob',
    currentLedgerParticipantId: 'lp1',
    currentMember: { id: 'cm-1', role: 'ADMIN', status: 'ACTIVE' },
    currentInvitation: null,
    linkInviteState: null,
  })
}

describe('EditGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setFriendGroup()
  })

  it('does not render the archive section for FRIEND groups', () => {
    render(<EditGroup />)

    expect(screen.queryByText('Archive group')).not.toBeInTheDocument()
  })

  it('does not render the delete section for FRIEND groups', () => {
    render(<EditGroup />)

    expect(screen.queryByText('Delete group')).not.toBeInTheDocument()
  })

  it('renders GroupForm with nameReadOnly={true} for FRIEND groups', () => {
    render(<EditGroup />)

    const groupForm = screen.getByTestId('group-form')
    expect(groupForm).toHaveAttribute('data-name-readonly', 'true')
  })

  it('renders the settings card (GroupForm) for FRIEND groups', () => {
    render(<EditGroup />)

    expect(screen.getByTestId('group-form')).toBeInTheDocument()
  })

  // ── GROUP-type control tests (tasks 13.30, 13.31) ────────────────

  function setGroupGroup() {
    mocks.mockUseCurrentGroup.mockReturnValue({
      isLoading: false,
      groupId: 'group-2',
      group: {
        id: 'group-2',
        name: 'Regular Group',
        archived: false,
        currency: '$',
        currencyCode: 'USD',
        groupType: 'GROUP',
        friendPairKey: null,
        participants: [
          { id: 'lp1', name: 'Alice', pending: false, unlinked: false },
        ],
      },
      displayName: 'Regular Group',
      currentLedgerParticipantId: 'lp1',
      currentMember: { id: 'cm-1', role: 'ADMIN', status: 'ACTIVE' },
      currentInvitation: null,
      linkInviteState: null,
    })
  }

  it('renders archive section for GROUP groups (opposite of FRIEND assertion)', () => {
    setGroupGroup()
    render(<EditGroup />)

    expect(
      screen.getByRole('heading', { name: 'Archive group' }),
    ).toBeInTheDocument()
  })

  it('renders delete section for GROUP groups (opposite of FRIEND assertion)', () => {
    setGroupGroup()
    render(<EditGroup />)

    expect(
      screen.getByRole('heading', { name: 'Delete group' }),
    ).toBeInTheDocument()
  })

  it('renders GroupForm with nameReadOnly=false for GROUP groups', () => {
    setGroupGroup()
    render(<EditGroup />)

    const groupForm = screen.getByTestId('group-form')
    expect(groupForm).toHaveAttribute('data-name-readonly', 'false')
  })

  // GroupTabs Members tab is tested in apps/web/src/tests/components/GroupTabs.test.tsx
})
