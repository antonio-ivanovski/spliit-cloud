import { describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'

vi.mock('@/app/groups/[groupId]/expenses/expense-list', () => ({
  ExpenseList: () => <div data-testid="expense-list">Expense list</div>,
}))

import GroupExpensesPageClient from '@/app/groups/[groupId]/expenses/page.client'

describe('GroupExpensesPageClient', () => {
  it('uses the shared continuous scan surface', () => {
    render(<GroupExpensesPageClient />)

    const surface = screen
      .getByTestId('expense-list')
      .closest('[data-scan-surface]')
    expect(surface).toHaveClass('-mx-1', 'sm:mx-0', 'sm:rounded-lg')
    expect(surface).not.toHaveClass('rounded-lg', 'border', 'bg-card')
  })

  it('renders without a bulk import action (import lives in Tools)', () => {
    render(<GroupExpensesPageClient />)

    expect(screen.getByText('Expense list')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /import/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /import/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Add expense' }),
    ).not.toBeInTheDocument()
  })
})
