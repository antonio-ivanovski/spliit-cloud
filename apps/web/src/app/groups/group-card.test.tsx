import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { AccountGroup } from '@/app/groups/group-buckets'
import { GroupCard } from '@/app/groups/group-card'
import { render, screen } from '@/test/test-utils'

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
})
