import { describe, expect, it, vi } from 'vitest'

import { BudgetForm } from '@/app/groups/[groupId]/budgets/budget-form'
import type { BudgetDetail } from '@/app/groups/[groupId]/budgets/budget-types'
import { render, screen } from '@/test/test-utils'

vi.mock(import('@/lib/hooks'), async (importActual) => {
  const actual = await importActual()
  return { ...actual, useMediaQuery: () => true }
})

const fakeGroup = {
  currency: '$',
  currencyCode: 'USD',
  participants: [
    { id: 'p1', name: 'Alice' },
    { id: 'p2', name: 'Bob' },
  ],
}

const selectedBudget = {
  name: 'Food budget',
  amount: 50000,
  periodType: 'MONTHLY',
  customStart: null,
  customEnd: null,
  categoryScope: 'SELECTED',
  categoryNodeIds: ['groceries'],
  participantScope: 'SELECTED',
  participantIds: ['p1'],
  notifyTrending: true,
  notifyOver: true,
} as unknown as BudgetDetail

describe('BudgetForm', () => {
  it('shows the currency code prefix from the group and a non-numeric amount input', () => {
    const { container } = render(
      <BudgetForm group={fakeGroup} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    )

    expect(screen.getByText('USD')).toBeInTheDocument()

    const amountInput = screen.getByLabelText('Amount') as HTMLInputElement
    expect(amountInput.type).toBe('text')
    expect(amountInput).toHaveAttribute('inputmode', 'decimal')

    expect(screen.queryByRole('combobox', { name: /currency/i })).toBeNull()
    expect(container.querySelector('input[type="number"]')).toBeNull()
  })

  it('renders scope radio cards for both categories and participants', () => {
    render(
      <BudgetForm group={fakeGroup} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    )

    expect(
      screen.getByRole('radio', { name: 'All categories' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: 'Selected categories' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: 'All participants' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: 'Selected participants' }),
    ).toBeInTheDocument()
  })

  it('shows All badges when scopes are ALL', () => {
    render(
      <BudgetForm group={fakeGroup} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    )

    // Radio label + scope badge each render the "All" text.
    expect(screen.getAllByText('All categories')).toHaveLength(2)
    expect(screen.getAllByText('All participants')).toHaveLength(2)
  })

  it('shows removable badges for selected categories and participants', () => {
    render(
      <BudgetForm
        group={fakeGroup}
        budget={selectedBudget}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByText('Groceries')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(2)
  })

  it('reveals the category picker combobox only after selecting the SELECTED card', async () => {
    const { user } = render(
      <BudgetForm group={fakeGroup} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    )

    expect(screen.queryByText('Choose categories')).toBeNull()

    await user.click(screen.getByRole('radio', { name: 'Selected categories' }))

    const pickerTrigger = await screen.findByText('Choose categories')
    expect(
      pickerTrigger.closest('button[aria-haspopup="listbox"]'),
    ).toBeInTheDocument()
  })

  it('renders the period hint with the current MONTHLY range', () => {
    render(
      <BudgetForm group={fakeGroup} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    )

    const hint = screen.getByText(/Current period:/)
    expect(hint).toBeInTheDocument()
    expect(hint.textContent).not.toContain('{range}')
    expect(hint.textContent).not.toContain('{from}')
    expect(hint.textContent).not.toContain('{to}')
    expect(hint.textContent).toMatch(
      /Current period:\s*\d{2}\.\d{2}\.\d{4}\s*–\s*\d{2}\.\d{2}\.\d{4}\s*$/,
    )
  })
})
