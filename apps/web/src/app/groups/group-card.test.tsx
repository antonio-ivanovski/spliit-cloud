import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { AccountGroup } from '@/app/groups/group-buckets'
import { GroupCard } from '@/app/groups/group-card'
import { render, screen } from '@/test/test-utils'
import type { AppRouterOutput } from '@spliit/api/router'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    search,
    ...props
  }: {
    to: string
    children: React.ReactNode
    search?: { viewKey?: string }
    [key: string]: unknown
  }) => (
    <a
      href={`${to}${search?.viewKey ? `?viewKey=${search.viewKey}` : ''}`}
      {...props}
    >
      {children}
    </a>
  ),
}))

function viewOnlyGroup(overrides: Partial<AccountGroup> = {}): AccountGroup {
  return {
    id: 'group-1',
    name: 'Trip',
    information: null,
    archived: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    groupType: 'GROUP',
    emoji: null,
    color: null,
    ledger: { currency: 'USD', currencyCode: 'USD' },
    memberCount: 3,
    currentMemberRole: 'MEMBER',
    preference: { starred: false, hidden: false },
    displayName: 'Trip',
    friendAccount: null,
    memberAccounts: [
      {
        id: 'acct-ada',
        name: 'Ada',
        image: 'https://example.com/ada.png',
      },
    ],
    financialSummary: {
      expenseCount: 0,
      netBalance: null,
      state: 'UNAVAILABLE',
      latestExpenseCreatedAt: null,
    },
    access: 'VIEW_ONLY',
    viewKey: 'secret',
    lastOpenedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('GroupCard view-only', () => {
  it('shows star, hide, and remove for a signed-in bookmark', async () => {
    const onStar = vi.fn()
    const onHide = vi.fn()
    const onRemove = vi.fn()
    render(
      <ul>
        <GroupCard
          group={viewOnlyGroup()}
          onToggleStar={onStar}
          onToggleHidden={onHide}
          onRemoveSavedView={onRemove}
        />
      </ul>,
    )

    expect(screen.getByText('View-only')).toBeInTheDocument()
    expect(document.querySelector('.lucide-eye')).not.toBeNull()
    expect(
      screen.getByRole('button', { name: 'Star group' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Balances')).toBeNull()
    expect(
      document.querySelector('img[src="https://example.com/ada.png"]'),
    ).not.toBeNull()
    expect(screen.getByRole('link', { name: 'Trip' })).toHaveAttribute(
      'href',
      '/groups/$groupId?viewKey=secret',
    )

    await userEvent.click(screen.getByRole('button', { name: 'Star group' }))
    expect(onStar).toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Group actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Hide group' }))
    expect(onHide).toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Group actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
    expect(onRemove).toHaveBeenCalled()
  })

  it('omits star and hide when those actions are not provided', async () => {
    const onRemove = vi.fn()
    render(
      <ul>
        <GroupCard group={viewOnlyGroup()} onRemoveSavedView={onRemove} />
      </ul>,
    )

    expect(screen.queryByRole('button', { name: /star/i })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Group actions' }))
    expect(screen.queryByRole('menuitem', { name: 'Hide group' })).toBeNull()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
    expect(onRemove).toHaveBeenCalled()
  })

  it('renders the emoji in the full-height rail with the card accent', () => {
    const { container } = render(
      <ul>
        <GroupCard group={viewOnlyGroup({ emoji: '🎉', color: 'teal' })} />
      </ul>,
    )

    const badge = container.querySelector('[data-group-emoji]')
    expect(badge).not.toBeNull()
    expect(badge).toHaveTextContent('🎉')

    const rail = container.querySelector('[data-group-rail]')
    expect(rail).not.toBeNull()
    expect(rail).toHaveClass('self-stretch', 'group-accent-rail')

    const card = container.querySelector('.group-accent-card')
    expect(card).not.toBeNull()
    expect((card as HTMLElement).style.getPropertyValue('--group-accent')).toBe(
      '#14b8a6',
    )

    const declined = render(
      <ul>
        <GroupCard group={viewOnlyGroup({ emoji: '', color: null })} />
      </ul>,
    )
    expect(declined.container.querySelector('[data-group-emoji]')).toBeNull()
    expect(declined.container.querySelector('[data-group-rail]')).toBeNull()
    expect(declined.container.querySelector('.group-accent-card')).toBeNull()
  })

  it('supports custom hex colors for the card accent', () => {
    const { container } = render(
      <ul>
        <GroupCard group={viewOnlyGroup({ emoji: '🎉', color: '#a1b2c3' })} />
      </ul>,
    )

    const card = container.querySelector('.group-accent-card')
    expect(card).not.toBeNull()
    expect((card as HTMLElement).style.getPropertyValue('--group-accent')).toBe(
      '#a1b2c3',
    )
  })

  it('keeps the peer avatar inside the rail for friend ledgers', () => {
    const { container } = render(
      <ul>
        <GroupCard
          group={viewOnlyGroup({
            groupType: 'FRIEND',
            emoji: '🎉',
            color: 'teal',
            friendAccount: {
              id: 'acct-peer',
              name: 'Bob',
              image: 'https://example.com/bob.png',
            },
          })}
        />
      </ul>,
    )

    expect(container.querySelector('[data-group-emoji]')).toBeNull()
    const rail = container.querySelector('[data-group-rail]')
    expect(rail).not.toBeNull()
    expect(
      rail!.querySelector('img[src="https://example.com/bob.png"]'),
    ).not.toBeNull()
  })
})

/** Shape returned by `account.groups`, without summary or access grant. */
type AccountGroupsItem = AppRouterOutput['account']['groups']['groups'][number]

function accountGroupsItem(
  overrides: Partial<AccountGroupsItem> = {},
): AccountGroupsItem {
  return {
    id: 'group-9',
    name: 'Imported trip',
    information: null,
    archived: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    groupType: 'GROUP',
    emoji: '🍻',
    color: 'teal',
    ledger: { currency: '€', currencyCode: 'EUR' },
    memberCount: 3,
    currentMemberRole: 'ADMIN',
    preference: { starred: false, hidden: false },
    displayName: 'Imported trip',
    friendAccount: null,
    memberAccounts: [
      { id: 'acct-ada', name: 'Ada', image: 'https://example.com/ada.png' },
    ],
    latestExpenseCreatedAt: null,
    ...overrides,
  }
}

describe('GroupCard selection mode', () => {
  it('renders an account-groups item as a single button with home visuals', async () => {
    const onSelect = vi.fn()
    const { container } = render(
      <ul>
        <GroupCard
          group={accountGroupsItem()}
          hideFinancialSummary
          onToggleStar={vi.fn()}
          onSelect={onSelect}
        />
      </ul>,
    )

    const card = screen.getByRole('button', { name: /Imported trip/ })
    // Same accent card + emoji rail + member row as home, no balance line.
    expect(card).toHaveTextContent('🍻')
    expect(card).toHaveTextContent('3')
    expect(container.querySelector('.group-accent-card')).not.toBeNull()
    expect(container.querySelector('[data-group-rail]')).toHaveClass(
      'group-accent-rail',
    )
    expect(
      container.querySelector('img[src="https://example.com/ada.png"]'),
    ).not.toBeNull()
    expect(screen.queryByText('Balances')).toBeNull()
    // No navigation link and no star/menu actions in selection mode.
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button', { name: /star/i })).toBeNull()

    await userEvent.click(card)
    expect(onSelect).toHaveBeenCalledWith('group-9')

    onSelect.mockClear()
    card.focus()
    await userEvent.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith('group-9')

    onSelect.mockClear()
    await userEvent.keyboard(' ')
    expect(onSelect).toHaveBeenCalledWith('group-9')
  })
})
