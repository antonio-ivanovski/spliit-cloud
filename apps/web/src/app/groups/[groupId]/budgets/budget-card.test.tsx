import { describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'

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

import { BudgetCard } from '@/app/groups/[groupId]/budgets/budget-card'
import type { BudgetSummary } from '@/app/groups/[groupId]/budgets/budget-types'

const group = { currency: '$', currencyCode: 'USD', participants: [] }

function makeBudget(overrides: Partial<BudgetSummary> = {}): BudgetSummary {
  return {
    id: 'b1',
    name: 'Groceries',
    amount: 50000,
    periodType: 'MONTHLY',
    customStart: null,
    customEnd: null,
    categoryScope: 'ALL',
    categoryNodeIds: [],
    participantScope: 'ALL',
    participantIds: [],
    permissions: {
      canEdit: true,
      canArchive: true,
      canDelete: true,
    },
    period: {
      from: '2026-07-01T00:00:00Z',
      to: '2026-07-31T00:00:00Z',
      used: 12345,
      limit: 50000,
      remaining: 37655,
      percentage: 24.69,
      projected: 40000,
      trendStatus: 'ON_TRACK',
      daysRemaining: 10,
      committed: 0,
    },
    ...overrides,
  }
}

describe('BudgetCard', () => {
  it('wraps the whole card in a link to the budget detail URL', () => {
    const { container } = render(
      <BudgetCard budget={makeBudget()} groupId="g1" group={group} />,
    )

    const link = container.querySelector('a')
    expect(link).toHaveAttribute('href', '/groups/g1/budgets/b1')
    expect(link).toHaveTextContent('Groceries')
    expect(container.querySelectorAll('a')).toHaveLength(1)
    expect(container.querySelector('button')).toBeNull()
  })

  it('renders name, status, amounts, and scope', () => {
    render(<BudgetCard budget={makeBudget()} groupId="g1" group={group} />)

    expect(screen.getByText('Groceries')).toBeInTheDocument()
    expect(screen.getAllByText('On track').length).toBeGreaterThan(0)
    expect(screen.getByText('$123.45')).toBeInTheDocument()
    expect(screen.getByText('of $500.00')).toBeInTheDocument()
    expect(screen.getByText('$376.55 remaining')).toBeInTheDocument()
    expect(screen.getAllByText('All categories').length).toBeGreaterThan(0)
    expect(screen.getAllByText('All participants').length).toBeGreaterThan(0)
  })

  it('shows the destructive over-budget state and hides projected when compact', () => {
    render(
      <BudgetCard
        budget={makeBudget({
          period: {
            ...makeBudget().period,
            used: 60000,
            remaining: -10000,
            percentage: 120,
            trendStatus: 'OVER',
          },
        })}
        groupId="g1"
        group={group}
        compact
      />,
    )

    expect(screen.getAllByText('Over budget').length).toBeGreaterThan(0)
    expect(screen.getByText('$100.00 over')).toBeInTheDocument()
    expect(screen.queryByText(/Projected/)).toBeNull()
  })
})
