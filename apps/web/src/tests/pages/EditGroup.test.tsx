import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  mockUseCurrentGroup: vi.fn(),
  mockUseIsReadOnlyGroupViewer: vi.fn(() => false),
}))

vi.mock('@/app/groups/[groupId]/current-group-context', () => ({
  useCurrentGroup: mocks.mockUseCurrentGroup,
  useCurrentGroupOrNull: () => null,
  useIsReadOnlyGroupViewer: mocks.mockUseIsReadOnlyGroupViewer,
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
      reports: {
        bounds: {
          useQuery: vi.fn(() => ({ data: undefined })),
        },
      },
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
  GroupForm: (props: {
    hideNameField?: boolean
    readOnly?: boolean
    additionalSettings?: React.ReactNode
  }) => (
    <div
      data-testid="group-form"
      data-hide-name-field={String(props.hideNameField)}
      data-read-only={String(props.readOnly)}
      data-has-additional-settings={String(!!props.additionalSettings)}
    >
      {props.hideNameField ? null : <input aria-label="Group name" />}
      GroupForm
    </div>
  ),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}))

vi.mock('@/lib/api-url', () => ({
  getApiBaseUrl: () => 'http://localhost:3001',
}))

vi.mock('@/components/force-archive-dialog', () => ({
  ForceArchiveDialog: () => null,
}))

vi.mock('@/app/groups/[groupId]/edit/delete-group-dialog', () => ({
  DeleteGroupDialog: () => null,
}))

vi.mock('@/app/groups/[groupId]/edit/group-view-link-card', () => ({
  PublicViewOnlyLinkSection: () => (
    <section data-testid="public-view-link-card">Public View-only link</section>
  ),
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
    mocks.mockUseIsReadOnlyGroupViewer.mockReturnValue(false)
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

  it('renders the Public View-only link card below Group information', () => {
    setGroupGroup()
    render(<EditGroup />)

    const groupForm = screen.getByTestId('group-form')
    const publicViewLink = screen.getByTestId('public-view-link-card')
    expect(
      groupForm.compareDocumentPosition(publicViewLink) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  // ── Export card visibility ─────────────────────────────────────────

  it('renders the export options card for admins', () => {
    render(<EditGroup />)

    expect(
      screen.getByRole('button', { name: 'Print / save PDF' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download CSV' })).toHaveAttribute(
      'href',
      'http://localhost:3001/groups/group-1/expenses/export/csv',
    )
    expect(
      screen.getByRole('link', { name: 'Download bundle' }),
    ).toHaveAttribute(
      'href',
      'http://localhost:3001/groups/group-1/export/bundle',
    )
  })

  it('renders the export options card for members', () => {
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
        participants: [],
      },
      displayName: 'Alice & Bob',
      currentLedgerParticipantId: 'lp1',
      currentMember: { id: 'cm-1', role: 'MEMBER', status: 'ACTIVE' },
      currentInvitation: null,
      linkInviteState: null,
    })
    render(<EditGroup />)

    expect(screen.getByTestId('group-form')).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Group settings' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Print / save PDF' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Download CSV' }),
    ).toBeInTheDocument()
  })

  it('renders the regular Group information form read-only for invitees', () => {
    mocks.mockUseIsReadOnlyGroupViewer.mockReturnValue(true)
    mocks.mockUseCurrentGroup.mockReturnValue({
      isLoading: false,
      groupId: 'group-1',
      group: {
        id: 'group-1',
        name: 'Regular Group',
        information: 'Checkout is at 11am',
        archived: false,
        currency: '$',
        currencyCode: 'USD',
        groupType: 'GROUP',
        friendPairKey: null,
        participants: [],
      },
      displayName: 'Regular Group',
      currentLedgerParticipantId: null,
      currentMember: null,
      currentInvitation: { id: 'inv-1', role: 'MEMBER', type: 'EMAIL' },
      linkInviteState: null,
    })
    render(<EditGroup />)

    expect(screen.getByTestId('group-form')).toHaveAttribute(
      'data-read-only',
      'true',
    )
    expect(screen.getByTestId('group-form')).toHaveAttribute(
      'data-has-additional-settings',
      'false',
    )
    expect(
      screen.queryByRole('link', { name: 'Download CSV' }),
    ).not.toBeInTheDocument()
  })

  // GroupTabs Members tab is tested in apps/web/src/tests/components/GroupTabs.test.tsx
})
