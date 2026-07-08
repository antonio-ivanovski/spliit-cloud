import type { AccountGroup } from '@/app/groups/group-buckets'
import { render, screen } from '@/test/test-utils'
import { describe, expect, it, vi } from 'vitest'

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

import { GroupCard } from '@/app/groups/group-card'

function makeFriendGroup(overrides: Record<string, unknown> = {}) {
  return {
    id: 'friend-1',
    name: 'fri-ledger-abc',
    groupType: 'FRIEND' as const,
    archived: false,
    createdAt: '2026-06-01T00:00:00Z',
    displayName: 'Alice',
    _count: { members: 2 },
    currentMemberRole: 'ADMIN' as const,
    preference: { starred: false, hidden: false },
    information: null,
    updatedAt: '2026-06-01T00:00:00Z',
    ledgerId: 'ledger-1',
    currency: 'USD',
    currencyCode: 'USD',
    ledger: {
      id: 'ledger-1',
      currency: 'USD',
      currencyCode: 'USD',
      groupId: 'friend-1',
      createdAt: '2026-06-01T00:00:00Z',
      updatedAt: '2026-06-01T00:00:00Z',
    },
    members: [],
    invitations: [],
    ...overrides,
  } as unknown as AccountGroup
}

function makeRegularGroup(overrides: Record<string, unknown> = {}) {
  return {
    id: 'group-1',
    name: 'Trip',
    groupType: 'GROUP' as const,
    archived: false,
    createdAt: '2026-06-01T00:00:00Z',
    displayName: 'Trip',
    _count: { members: 4 },
    currentMemberRole: 'ADMIN' as const,
    preference: { starred: false, hidden: false },
    information: null,
    updatedAt: '2026-06-01T00:00:00Z',
    ledgerId: 'ledger-1',
    currency: 'USD',
    currencyCode: 'USD',
    ledger: {
      id: 'ledger-1',
      currency: 'USD',
      currencyCode: 'USD',
      groupId: 'group-1',
      createdAt: '2026-06-01T00:00:00Z',
      updatedAt: '2026-06-01T00:00:00Z',
    },
    members: [],
    invitations: [],
    ...overrides,
  } as unknown as AccountGroup
}

describe('GroupCard — friend-ledger behavior', () => {
  it('renders displayName (not group.name) for a FRIEND card', () => {
    render(
      <GroupCard
        group={makeFriendGroup({
          name: 'fri-ledger-abc',
          displayName: 'Alice',
        })}
        onToggleStar={() => {}}
        onToggleHidden={() => {}}
      />,
    )
    // The displayName "Alice" is rendered
    expect(screen.getByText('Alice')).toBeInTheDocument()
    // The link points to the group page
    expect(screen.getByRole('link')).toHaveAttribute('href', '/groups/friend-1')
  })

  it('shows an initials avatar for FRIEND cards (first letter of displayName)', () => {
    render(
      <GroupCard
        group={makeFriendGroup({ displayName: 'Alice' })}
        onToggleStar={() => {}}
        onToggleHidden={() => {}}
      />,
    )
    // The initials avatar is rendered with the first letter
    const avatar = screen.getByText('A')
    expect(avatar).toBeInTheDocument()
  })

  it('falls back to "?" for an empty displayName avatar', () => {
    render(
      <GroupCard
        group={makeFriendGroup({ displayName: '' })}
        onToggleStar={() => {}}
        onToggleHidden={() => {}}
      />,
    )
    // Empty displayName renders the "?" fallback
    expect(screen.getByText('?')).toBeInTheDocument()
  })

  it('does not show an avatar for GROUP cards', () => {
    render(
      <GroupCard
        group={makeRegularGroup()}
        onToggleStar={() => {}}
        onToggleHidden={() => {}}
      />,
    )
    // No avatar/initial for GROUP cards; the title "Trip" is rendered
    // without a preceding initials span. The aria-hidden initials
    // element only renders for isFriend.
    expect(screen.queryByText('T')).not.toBeInTheDocument()
    expect(screen.getByText('Trip')).toBeInTheDocument()
  })

  it('shows a Pending badge for a FRIEND card with only one ACTIVE member', () => {
    render(
      <GroupCard
        group={makeFriendGroup({ _count: { members: 1 } })}
        onToggleStar={() => {}}
        onToggleHidden={() => {}}
      />,
    )
    expect(screen.getByText('Pending')).toBeInTheDocument()
  })

  it('does not show a Pending badge for a FRIEND card with two ACTIVE members', () => {
    render(
      <GroupCard
        group={makeFriendGroup({ _count: { members: 2 } })}
        onToggleStar={() => {}}
        onToggleHidden={() => {}}
      />,
    )
    expect(screen.queryByText('Pending')).not.toBeInTheDocument()
  })

  it('does not show the archive action in the dropdown for FRIEND cards', async () => {
    const { user } = render(
      <GroupCard
        group={makeFriendGroup()}
        onToggleStar={() => {}}
        onToggleHidden={() => {}}
        onToggleArchived={() => {}}
      />,
    )
    // Open the dropdown
    const actionsButton = screen.getByRole('button', {
      name: /friend ledger actions/i,
    })
    await user.click(actionsButton)
    // Hide/unhide is shown
    expect(screen.getByText(/hide/i)).toBeInTheDocument()
    // Archive is NOT shown for FRIEND
    expect(screen.queryByText('Archive group')).not.toBeInTheDocument()
  })

  it('shows the archive action in the dropdown for GROUP cards', async () => {
    const { user } = render(
      <GroupCard
        group={makeRegularGroup()}
        onToggleStar={() => {}}
        onToggleHidden={() => {}}
        onToggleArchived={() => {}}
      />,
    )
    const actionsButton = screen.getByRole('button', {
      name: /group actions/i,
    })
    await user.click(actionsButton)
    expect(screen.getByText('Archive group')).toBeInTheDocument()
  })
})
