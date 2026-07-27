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
    memberCount: 2,
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
    financialSummary: {
      expenseCount: 0,
      netBalance: 0,
      state: 'NO_EXPENSES' as const,
      latestExpenseCreatedAt: null,
    },
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
    memberCount: 4,
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
    memberAccounts: [
      { id: 'acct-me', name: 'Me', image: null },
      { id: 'acct-bob', name: 'Bob', image: null },
    ],
    financialSummary: {
      expenseCount: 0,
      netBalance: 0,
      state: 'NO_EXPENSES' as const,
      latestExpenseCreatedAt: null,
    },
    ...overrides,
  } as unknown as AccountGroup
}

describe('GroupCard — friend-ledger behavior', () => {
  it('renders the current user balance state in the card', () => {
    const { container } = render(
      <GroupCard
        group={makeRegularGroup({
          ledger: { currency: '$', currencyCode: 'USD' },
          financialSummary: {
            expenseCount: 1,
            netBalance: -1250,
            state: 'YOU_OWE',
            latestExpenseCreatedAt: '2026-06-02T00:00:00Z',
          },
        })}
        onToggleStar={() => {}}
        onToggleHidden={() => {}}
      />,
    )
    expect(screen.getByText('You owe')).toBeInTheDocument()
    expect(screen.getByText('$12.50')).toBeInTheDocument()
    expect(
      container.querySelector('.lucide-banknote-arrow-up'),
    ).toBeInTheDocument()
  })

  it('renders owed and settled states without relying on color', () => {
    const { container, rerender } = render(
      <GroupCard
        group={makeRegularGroup({
          financialSummary: {
            expenseCount: 1,
            netBalance: 850,
            state: 'OWED_TO_YOU',
            latestExpenseCreatedAt: '2026-06-02T00:00:00Z',
          },
        })}
        onToggleStar={() => {}}
        onToggleHidden={() => {}}
      />,
    )
    expect(screen.getByText('You are owed')).toBeInTheDocument()
    expect(screen.getByText('$8.50')).toBeInTheDocument()
    expect(
      container.querySelector('.lucide-banknote-arrow-down'),
    ).toBeInTheDocument()

    rerender(
      <GroupCard
        group={makeRegularGroup({
          financialSummary: {
            expenseCount: 2,
            netBalance: 0,
            state: 'SETTLED',
            latestExpenseCreatedAt: '2026-06-02T00:00:00Z',
          },
        })}
        onToggleStar={() => {}}
        onToggleHidden={() => {}}
      />,
    )
    expect(screen.getByText('Settled up')).toBeInTheDocument()
    expect(
      container.querySelector('.lucide-banknote-check'),
    ).toBeInTheDocument()
  })

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

  it('shows a friend avatar for FRIEND cards', () => {
    render(
      <GroupCard
        group={makeFriendGroup({
          displayName: 'Alice',
          friendAccount: { id: 'acct-bob', name: 'Alice', image: null },
        })}
        onToggleStar={() => {}}
        onToggleHidden={() => {}}
      />,
    )
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('shows a question-mark fallback when the friend has no name', () => {
    render(
      <GroupCard
        group={makeFriendGroup({
          displayName: '',
          friendAccount: { id: 'acct-bob', name: '', image: null },
        })}
        onToggleStar={() => {}}
        onToggleHidden={() => {}}
      />,
    )
    expect(screen.getByText('?')).toBeInTheDocument()
  })

  it('keeps the member count and avatar stack on GROUP cards', () => {
    render(
      <GroupCard
        group={makeRegularGroup()}
        onToggleStar={() => {}}
        onToggleHidden={() => {}}
      />,
    )
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByLabelText('4 members')).toBeInTheDocument()
    expect(screen.getByText('Trip')).toBeInTheDocument()
  })

  it('shows a Pending badge for a FRIEND card with only one ACTIVE member', () => {
    render(
      <GroupCard
        group={makeFriendGroup({ memberCount: 1 })}
        onToggleStar={() => {}}
        onToggleHidden={() => {}}
      />,
    )
    expect(screen.getByText('Pending')).toBeInTheDocument()
  })

  it('does not show a Pending badge for a FRIEND card with two ACTIVE members', () => {
    render(
      <GroupCard
        group={makeFriendGroup({ memberCount: 2 })}
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
      name: /friend expense actions/i,
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
