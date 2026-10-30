import { describe, expect, it, vi } from 'vitest'

import {
  findOverlapWarning,
  PersonalBudgetForm,
} from '@/app/personal/budget-form'
import type { PersonalBudget } from '@/app/personal/types'
import { render, screen } from '@/test/test-utils'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}))

function budget(overrides: Partial<PersonalBudget> = {}): PersonalBudget {
  return {
    id: 'budget-1',
    name: 'Groceries',
    amount: 20000,
    currencyCode: 'USD',
    categoryScope: 'ALL',
    categoryIds: [],
    spent: 8000,
    remaining: 12000,
    ratio: 0.4,
    projected: 12000,
    state: 'OK',
    ...overrides,
  }
}

describe('PersonalBudgetForm', () => {
  it('requires a name before submitting', async () => {
    const onSubmit = vi.fn()
    const { user } = render(
      <PersonalBudgetForm
        currencyCode="USD"
        existingBudgets={[]}
        onSubmit={onSubmit}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Save budget' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Give the budget a name.',
    )
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('requires a positive amount', async () => {
    const onSubmit = vi.fn()
    const { user } = render(
      <PersonalBudgetForm
        currencyCode="USD"
        existingBudgets={[]}
        onSubmit={onSubmit}
      />,
    )

    await user.type(screen.getByLabelText('Name'), 'Food')
    await user.click(screen.getByRole('button', { name: 'Save budget' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter an amount greater than zero.',
    )
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits monthly minor-unit values for the ALL scope', async () => {
    const onSubmit = vi.fn()
    const { user } = render(
      <PersonalBudgetForm
        currencyCode="USD"
        existingBudgets={[]}
        onSubmit={onSubmit}
      />,
    )

    await user.type(screen.getByLabelText('Name'), 'Food')
    await user.type(screen.getByLabelText('Amount'), '200')
    await user.click(screen.getByRole('button', { name: 'Save budget' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Food',
      amount: 20000,
      categoryScope: 'ALL',
      categoryIds: [],
    })
  })

  it('warns when the scope overlaps another budget', async () => {
    const { user } = render(
      <PersonalBudgetForm
        currencyCode="USD"
        existingBudgets={[budget()]}
        onSubmit={vi.fn()}
      />,
    )

    await user.type(screen.getByLabelText('Name'), 'Everything')
    await user.type(screen.getByLabelText('Amount'), '50')

    expect(screen.getByRole('note')).toHaveTextContent(
      'Groceries already covers this spending.',
    )
  })
})

describe('findOverlapWarning', () => {
  it('ignores the budget being edited', () => {
    expect(findOverlapWarning([budget()], 'budget-1', 'ALL', [])).toBeNull()
  })

  it('flags shared categories between SELECTED budgets', () => {
    const other = budget({
      id: 'budget-2',
      name: 'Food',
      categoryScope: 'SELECTED',
      categoryIds: ['groceries'],
    })
    expect(findOverlapWarning([other], null, 'SELECTED', ['groceries'])).toBe(
      'Food',
    )
    expect(
      findOverlapWarning([other], null, 'SELECTED', ['dining-out']),
    ).toBeNull()
  })
})
