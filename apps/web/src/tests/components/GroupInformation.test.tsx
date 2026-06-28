import { render, screen } from '@/test/test-utils'
import { describe, expect, it, vi } from 'vitest'

// ── Module mocks ────────────────────────────────────────────────────────

vi.mock('@/app/groups/[groupId]/current-group-context', () => ({
  useCurrentGroup: vi.fn(),
  useIsPendingInvitee: vi.fn(),
}))

// Mock @tanstack/react-router for Link
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...props
  }: {
    to: string
    children: React.ReactNode
    [key: string]: unknown
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

// ── SUT ─────────────────────────────────────────────────────────────────

import {
  useCurrentGroup,
  useIsPendingInvitee,
} from '@/app/groups/[groupId]/current-group-context'
import GroupInformation from '@/app/groups/[groupId]/information/group-information'

// ── Tests ───────────────────────────────────────────────────────────────

describe('GroupInformation', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('shows loading skeleton when loading', () => {
    vi.mocked(useCurrentGroup).mockReturnValue({
      isLoading: true,
      groupId: 'group-1',
      group: undefined,
      currentLedgerParticipantId: undefined,
      currentMember: undefined,
      currentInvitation: undefined,
      linkInviteState: undefined,
    })
    vi.mocked(useIsPendingInvitee).mockReturnValue(false)

    const { container } = render(<GroupInformation groupId="group-1" />)

    // Skeleton elements should be present
    const skeletons = container.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBeGreaterThanOrEqual(1)
  })

  it('shows group information text when group has information', () => {
    vi.mocked(useCurrentGroup).mockReturnValue({
      isLoading: false,
      groupId: 'group-1',
      group: {
        id: 'group-1',
        name: 'Trip',
        information: 'We are going to Paris!',
        archived: false,
        currency: 'EUR',
      },
      currentLedgerParticipantId: 'lp-1',
      currentMember: { id: 'cm-1', role: 'ADMIN' },
      currentInvitation: null,
      linkInviteState: null,
    })
    vi.mocked(useIsPendingInvitee).mockReturnValue(false)

    render(<GroupInformation groupId="group-1" />)

    expect(screen.getByText('We are going to Paris!')).toBeInTheDocument()
    expect(
      screen.queryByText('No group information yet.'),
    ).not.toBeInTheDocument()
  })

  it('shows empty state when group has no information', () => {
    vi.mocked(useCurrentGroup).mockReturnValue({
      isLoading: false,
      groupId: 'group-1',
      group: {
        id: 'group-1',
        name: 'Trip',
        information: null,
        archived: false,
        currency: 'EUR',
      },
      currentLedgerParticipantId: 'lp-1',
      currentMember: { id: 'cm-1', role: 'ADMIN' },
      currentInvitation: null,
      linkInviteState: null,
    })
    vi.mocked(useIsPendingInvitee).mockReturnValue(false)

    render(<GroupInformation groupId="group-1" />)

    expect(screen.getByText('No group information yet.')).toBeInTheDocument()
  })

  it('shows edit pencil button for non-PENDING members', () => {
    vi.mocked(useCurrentGroup).mockReturnValue({
      isLoading: false,
      groupId: 'group-1',
      group: {
        id: 'group-1',
        name: 'Trip',
        information: 'Some info',
        archived: false,
        currency: 'EUR',
      },
      currentLedgerParticipantId: 'lp-1',
      currentMember: { id: 'cm-1', role: 'ADMIN' },
      currentInvitation: null,
      linkInviteState: null,
    })
    vi.mocked(useIsPendingInvitee).mockReturnValue(false)

    render(<GroupInformation groupId="group-1" />)

    // Pencil icon should be present
    const pencil = document.querySelector('.lucide-pencil')
    expect(pencil).toBeInTheDocument()
    // And it should link to /groups/group-1/edit
    const editLink = pencil?.closest('a')
    expect(editLink).toHaveAttribute('href', '/groups/group-1/edit')
  })

  it('does NOT show edit button for PENDING invitees', () => {
    vi.mocked(useCurrentGroup).mockReturnValue({
      isLoading: false,
      groupId: 'group-1',
      group: {
        id: 'group-1',
        name: 'Trip',
        information: 'Some info',
        archived: false,
        currency: 'EUR',
      },
      currentLedgerParticipantId: null,
      currentMember: null,
      currentInvitation: { id: 'inv-1', email: 'test@example.com' },
      linkInviteState: null,
    })
    vi.mocked(useIsPendingInvitee).mockReturnValue(true)

    render(<GroupInformation groupId="group-1" />)

    // Pencil icon should NOT be present
    const pencil = document.querySelector('.lucide-pencil')
    expect(pencil).not.toBeInTheDocument()
  })
})
