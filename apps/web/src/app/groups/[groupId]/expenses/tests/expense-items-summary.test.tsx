import { ExpenseItemsSummary } from '@/app/groups/[groupId]/expenses/expense-items-summary'
import { render, screen } from '@/test/test-utils'

const EUR = { code: 'EUR', symbol: '€', decimal_digits: 2, rounding: 0 }

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
})
