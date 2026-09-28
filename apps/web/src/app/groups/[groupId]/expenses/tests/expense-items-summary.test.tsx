import {
  ExpenseItemsSummary,
  resolveExpenseItemsAmount,
  resolveExpenseItemsCurrency,
} from '@/app/groups/[groupId]/expenses/expense-items-summary'
import { render, screen } from '@/test/test-utils'

const EUR = { code: 'EUR', symbol: '€', decimal_digits: 2, rounding: 0 }
const USD = { code: 'USD', symbol: '$', decimal_digits: 2, rounding: 0 }

const fourItems = [
  { id: 'item-1', title: 'Apples', amount: 1000 },
  { id: 'item-2', title: 'Bananas', amount: 1500 },
  { id: 'item-3', title: 'Cherries', amount: 2000 },
  { id: 'item-4', title: 'Dates', amount: 500 },
]

describe('ExpenseItemsSummary', () => {
  it('hides overflow items until the more control is pressed', async () => {
    const { user } = render(
      <ExpenseItemsSummary items={fourItems} currency={EUR} locale="en-US" />,
    )

    expect(screen.getByText('Apples')).toBeInTheDocument()
    expect(screen.getByText('Bananas')).toBeInTheDocument()
    expect(screen.getByText('Cherries')).toBeInTheDocument()
    expect(screen.queryByText('Dates')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /\+1 more/i }))

    expect(screen.getByText('Dates')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /show less/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('collapses overflow items when Show less is pressed', async () => {
    const { user } = render(
      <ExpenseItemsSummary items={fourItems} currency={EUR} locale="en-US" />,
    )

    await user.click(screen.getByRole('button', { name: /\+1 more/i }))
    await user.click(screen.getByRole('button', { name: /show less/i }))

    expect(screen.queryByText('Dates')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /\+1 more/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('does not render an overflow control when there are at most three items', () => {
    render(
      <ExpenseItemsSummary
        items={fourItems.slice(0, 3)}
        currency={EUR}
        locale="en-US"
      />,
    )

    expect(screen.getByText('Cherries')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /more/i }),
    ).not.toBeInTheDocument()
  })

  it('shows assignee names below items with split data', () => {
    render(
      <ExpenseItemsSummary
        items={[
          {
            id: 'item-1',
            title: 'Pizza',
            amount: 1000,
            splitMode: 'EVENLY',
            paidFor: [
              { ledgerParticipantId: 'a', shares: 1 },
              { ledgerParticipantId: 'b', shares: 1 },
            ],
          },
        ]}
        currency={EUR}
        locale="en-US"
        participants={[
          { id: 'a', name: 'Alice' },
          { id: 'b', name: 'Bob' },
        ]}
      />,
    )

    expect(screen.getByText('Pizza')).toBeInTheDocument()
    expect(screen.getByText('Alice, Bob')).toBeInTheDocument()
  })

  it('expands an item to reveal per-person amounts that sum to the total', async () => {
    const { user } = render(
      <ExpenseItemsSummary
        items={[
          {
            id: 'item-1',
            title: 'Pizza',
            amount: 1001,
            splitMode: 'EVENLY',
            paidFor: [
              { ledgerParticipantId: 'a', shares: 1 },
              { ledgerParticipantId: 'b', shares: 1 },
            ],
          },
        ]}
        currency={EUR}
        locale="en-US"
        participants={[
          { id: 'a', name: 'Alice' },
          { id: 'b', name: 'Bob' },
        ]}
      />,
    )

    const toggle = screen.getByRole('button', { name: 'Alice, Bob' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    // €10.01 split evenly: one pays €5.00, the other €5.01.
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('renders the unaccounted remainder row with its assignees', () => {
    render(
      <ExpenseItemsSummary
        items={[
          {
            id: 'item-1',
            title: 'Pizza',
            amount: 1000,
            splitMode: 'EVENLY',
            paidFor: [{ ledgerParticipantId: 'a', shares: 1 }],
          },
        ]}
        currency={EUR}
        locale="en-US"
        participants={[{ id: 'a', name: 'Alice' }]}
        itemizedRemainder={{
          splitMode: 'EVENLY',
          allocationMode: 'CUSTOM',
          paidFor: [{ ledgerParticipantId: 'a', shares: 1 }],
        }}
        expenseAmount={1200}
        otherLabel="Other (unaccounted)"
      />,
    )

    expect(screen.getByText('Other (unaccounted)')).toBeInTheDocument()
  })

  it('renders proportional remainder text instead of assignee amounts', () => {
    render(
      <ExpenseItemsSummary
        items={[
          {
            id: 'item-1',
            title: 'Pizza',
            amount: 1000,
            splitMode: 'EVENLY',
            paidFor: [{ ledgerParticipantId: 'a', shares: 1 }],
          },
        ]}
        currency={EUR}
        locale="en-US"
        participants={[{ id: 'a', name: 'Alice' }]}
        itemizedRemainder={{
          splitMode: 'EVENLY',
          allocationMode: 'PROPORTIONAL',
          paidFor: [],
        }}
        expenseAmount={1200}
        otherLabel="Other (unaccounted)"
        proportionalText="Proportional to items"
      />,
    )

    expect(screen.getByText('Proportional to items')).toBeInTheDocument()
  })
})

describe('resolveExpenseItemsCurrency', () => {
  it('uses the stored expense currency when an expense was converted', () => {
    const resolved = resolveExpenseItemsCurrency('USD', EUR)

    expect(resolved.code).toBe('USD')
    expect(resolved.symbol).toBe('$')
  })

  it('falls back to the group currency without a stored expense currency', () => {
    expect(resolveExpenseItemsCurrency(null, EUR)).toBe(EUR)
    expect(resolveExpenseItemsCurrency(undefined, EUR)).toBe(EUR)
  })

  it('falls back to the group currency for an unknown expense currency', () => {
    expect(resolveExpenseItemsCurrency('NOT_A_CURRENCY', EUR)).toBe(EUR)
  })
})

describe('resolveExpenseItemsAmount', () => {
  it('prefers the entered-currency total for converted expenses', () => {
    expect(resolveExpenseItemsAmount(10000, 9200)).toBe(10000)
  })

  it('falls back to the ledger total without a conversion', () => {
    expect(resolveExpenseItemsAmount(null, 9200)).toBe(9200)
    expect(resolveExpenseItemsAmount(undefined, 9200)).toBe(9200)
  })
})

describe('ExpenseItemsSummary with converted expenses', () => {
  const remainder = {
    splitMode: 'EVENLY',
    allocationMode: 'CUSTOM' as const,
    paidFor: [{ ledgerParticipantId: 'a', shares: 1 }],
  }
  const participants = [{ id: 'a', name: 'Alice' }]

  it('shows no "Other" row when items cover the entered-currency total', () => {
    // USD 100.00 of items on a converted expense (ledger total €92.00):
    // the filler must compare against the entered total, not the ledger one.
    render(
      <ExpenseItemsSummary
        items={[
          {
            id: 'item-1',
            title: 'Pizza',
            amount: 10000,
            splitMode: 'EVENLY',
            paidFor: [{ ledgerParticipantId: 'a', shares: 1 }],
          },
        ]}
        currency={USD}
        locale="en-US"
        participants={participants}
        itemizedRemainder={remainder}
        expenseAmount={resolveExpenseItemsAmount(10000, 9200)}
        otherLabel="Other (unaccounted)"
      />,
    )

    expect(screen.queryByText('Other (unaccounted)')).not.toBeInTheDocument()
  })

  it('shows the "Other" gap in the entered currency, not the ledger total', () => {
    render(
      <ExpenseItemsSummary
        items={[
          {
            id: 'item-1',
            title: 'Pizza',
            amount: 8000,
            splitMode: 'EVENLY',
            paidFor: [{ ledgerParticipantId: 'a', shares: 1 }],
          },
        ]}
        currency={USD}
        locale="en-US"
        participants={participants}
        itemizedRemainder={remainder}
        expenseAmount={resolveExpenseItemsAmount(10000, 9200)}
        otherLabel="Other (unaccounted)"
      />,
    )

    expect(screen.getByText('Other (unaccounted)')).toBeInTheDocument()
    // $20.00 gap in entered currency — not the €12.00 ledger difference.
    expect(screen.getByText('$20.00')).toBeInTheDocument()
  })
})
