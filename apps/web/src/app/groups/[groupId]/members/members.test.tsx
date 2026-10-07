import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'

import GroupMembers from './members'

const mocks = vi.hoisted(() => ({
  mockUseCurrentGroup: vi.fn(),
  mockUseOfflineWithoutData: vi.fn(() => false),
}))

vi.mock('../current-group-context', () => ({
  useCurrentGroup: mocks.mockUseCurrentGroup,
}))

vi.mock('@/lib/use-online-status', () => ({
  useOfflineWithoutData: mocks.mockUseOfflineWithoutData,
  useOnlineStatus: () => false,
}))

vi.mock('@/components/account-preferences-sync', () => ({
  useSyncedAccountPreferences: () => null,
}))

vi.mock('./members-hooks', () => ({
  useMembersDialogs: () => ({
    account: null,
    isArchived: false,
    isAdmin: true,
    canManage: true,
    canInvite: true,
    listMembers: [],
    membersQuery: { data: undefined, isLoading: false },
    invitations: [],
    invitationsQuery: { data: undefined, isLoading: false },
    createMutation: {},
    createLinkMutation: {},
    createParticipantMutation: {},
    updatePendingMutation: {},
    regenerateLinkMutation: {},
    updateRoleMutation: {},
    removeParticipantMutation: {},
    participantPendingRemove: null,
    setParticipantPendingRemove: vi.fn(),
    participantRemovePreviewQuery: { data: undefined },
    participantRemoveSettleChecked: false,
    setParticipantRemoveSettleChecked: vi.fn(),
    confirmParticipantRemove: vi.fn(),
    leaveDialogOpen: false,
    setLeaveDialogOpen: vi.fn(),
    promoteMemberId: null,
    setPromoteMemberId: vi.fn(),
    leavePreviewQuery: { data: undefined },
    preview: undefined,
    isLastActiveMember: false,
    isLastAdmin: false,
    hasUnsettledBalance: false,
    isAdminLeaving: false,
    otherAdmins: [],
    promotableMembers: [],
    needsPromotion: false,
    canConfirmLeave: false,
    handleConfirmLeave: vi.fn(),
    leaveMutation: {},
  }),
  useQrSession: () => [null, vi.fn()],
  roleLabel: (role: string) => role,
  badgeVariantForRole: () => 'outline',
  formatDate: () => 'Jan 1, 2026',
}))

vi.mock('./subgroups-card', () => ({
  SubgroupsCard: () => null,
}))

function mockAdminGroup() {
  mocks.mockUseCurrentGroup.mockReturnValue({
    groupId: 'grp-1',
    group: {
      id: 'grp-1',
      groupType: 'GROUP',
      members: [
        {
          id: 'member-1',
          role: 'ADMIN',
          joinedAt: new Date('2026-01-01T00:00:00Z'),
          account: { id: 'account-1', name: 'Alice', image: null },
        },
      ],
      participants: [
        {
          id: 'lp-1',
          name: 'Alice',
          account: { id: 'account-1', name: 'Alice', image: null },
          pending: false,
          unlinked: false,
        },
        {
          id: 'lp-2',
          name: 'Carol',
          account: null,
          pending: false,
          unlinked: true,
        },
      ],
    },
    viewer: { canMutate: true },
    currentMember: { id: 'member-1', role: 'ADMIN' },
  })
}

describe('GroupMembers offline read-only', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mockUseOfflineWithoutData.mockReturnValue(false)
    mockAdminGroup()
  })

  it('renders the downloaded roster read-only while offline', () => {
    mocks.mockUseOfflineWithoutData.mockReturnValue(true)
    render(<GroupMembers />)

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Carol')).toBeInTheDocument()
    expect(screen.getByText('Reconnect to make changes')).toBeInTheDocument()
    expect(
      screen.queryByTestId('offline-needs-connection'),
    ).not.toBeInTheDocument()
  })

  it('shows the connection state offline without a downloaded group', () => {
    mocks.mockUseCurrentGroup.mockReturnValue({
      groupId: 'grp-1',
      group: undefined,
      viewer: { canMutate: true },
      currentMember: null,
    })
    mocks.mockUseOfflineWithoutData.mockReturnValue(true)
    render(<GroupMembers />)

    expect(screen.getByTestId('offline-needs-connection')).toBeInTheDocument()
  })
})
