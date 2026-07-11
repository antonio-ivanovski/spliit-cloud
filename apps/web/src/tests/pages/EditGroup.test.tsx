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
    features: {
      get: {
        useQuery: vi.fn(() => ({
          data: { enableBulkCategorize: false },
        })),
      },
    },
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
  GroupForm: (props: { hideNameField?: boolean; nameReadOnly?: boolean }) => (
    <div
      data-testid="group-form"
      data-hide-name-field={String(props.hideNameField)}
    >
      {props.hideNameField ? null : <input aria-label="Group name" />}
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
        {
          id: 'lp1',
          name: 'Alice',
          account: null,
          pending: false,
          unlinked: false,
        },
        {
          id: 'lp2',
          name: 'Bob',
          account: null,
          pending: false,
          unlinked: false,
        },
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

  it('hides the group name field for FRIEND groups', () => {
    render(<EditGroup />)

    expect(screen.queryByLabelText('Group name')).not.toBeInTheDocument()
    // Group form should still be rendered
    expect(screen.getByTestId('group-form')).toBeInTheDocument()
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
          {
            id: 'lp1',
            name: 'Alice',
            account: null,
            pending: false,
            unlinked: false,
          },
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

  it('renders the group name field for GROUP groups', () => {
    setGroupGroup()
    render(<EditGroup />)

    expect(screen.getByLabelText('Group name')).toBeInTheDocument()
  })

  // GroupTabs Members tab is tested in apps/web/src/tests/components/GroupTabs.test.tsx
})
