import { describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="/budgets/create">{children}</a>
  ),
}))

import { BudgetEmptyState } from './page.client'

describe('BudgetEmptyState', () => {
  it('keeps the desktop empty state centered in a constrained content column', () => {
    render(<BudgetEmptyState groupId="group-1" canCreate />)

    const state = screen.getByTestId('budget-empty-state')
    expect(state).toHaveClass(
      'mx-auto',
      'max-w-md',
      'items-center',
      'text-center',
    )
    expect(state.parentElement).toHaveClass(
      'px-4',
      'sm:px-6',
      'py-10',
      'sm:py-12',
    )
    expect(screen.getByRole('link', { name: /create budget/i })).toBeVisible()
  })
})
