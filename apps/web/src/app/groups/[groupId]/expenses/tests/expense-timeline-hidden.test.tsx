import { ExpenseTimeline } from '@/app/groups/[groupId]/expenses/expense-timeline'
import { render, screen } from '@/test/test-utils'

type FakeExpense = {
  id: string
  expenseDate: string
  expenseTimeZone: string
}

const TODAY = new Date().toISOString()
const OLDER = '2020-01-01T00:00:00.000Z'

function makeExpense(id: string, expenseDate: string): FakeExpense {
  return { id, expenseDate, expenseTimeZone: 'UTC' }
}

function renderTimeline(
  expenses: FakeExpense[],
  involvingIds: Set<string>,
  options?: { showAll?: boolean; sortBy?: 'expenseDate' | 'amount' },
) {
  return render(
    <ExpenseTimeline
      expenses={expenses}
      sortBy={options?.sortBy ?? 'expenseDate'}
      timeZone="UTC"
      hasMore={false}
      isInvolving={(expense) => involvingIds.has(expense.id)}
      showAll={options?.showAll ?? false}
      renderExpense={(expense) => (
        <div key={expense.id}>{`Expense ${expense.id}`}</div>
      )}
    />,
  )
}

/** Text of each row (expense card or hidden-run toggle) in DOM order. */
function orderedRowLabels(container: HTMLElement): string[] {
  const bucket = container.querySelector('.motion-stagger')
  if (!bucket) throw new Error('expected a timeline bucket to render')
  return [...bucket.children]
    .filter((el) => !el.classList.contains('sticky'))
    .map((el) => (el.textContent ?? '').trim())
}

describe('ExpenseTimeline hidden-expenses collapse', () => {
  it('shows every expense with no toggle when showAll is true', () => {
    renderTimeline(
      [makeExpense('mine', TODAY), makeExpense('theirs', TODAY)],
      new Set(['mine']),
      { showAll: true },
    )

    expect(screen.getByText('Expense mine')).toBeInTheDocument()
    expect(screen.getByText('Expense theirs')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /not involving you/i }),
    ).not.toBeInTheDocument()
  })

  it('collapses a hidden run inline, preserving chronological order', () => {
    const { container } = renderTimeline(
      [
        makeExpense('m1', TODAY),
        makeExpense('t1', TODAY),
        makeExpense('t2', TODAY),
        makeExpense('t3', TODAY),
        makeExpense('t4', TODAY),
        makeExpense('m2', TODAY),
        makeExpense('t5', TODAY),
        makeExpense('t6', TODAY),
        makeExpense('m3', TODAY),
        makeExpense('m4', TODAY),
      ],
      new Set(['m1', 'm2', 'm3', 'm4']),
    )

    expect(orderedRowLabels(container)).toEqual([
      'Expense m1',
      '4 hidden expenses not involving you',
      'Expense m2',
      '2 hidden expenses not involving you',
      'Expense m3',
      'Expense m4',
    ])
  })

  it('expands a hidden run in place without disturbing other runs', async () => {
    const { container, user } = renderTimeline(
      [
        makeExpense('m1', TODAY),
        makeExpense('t1', TODAY),
        makeExpense('t2', TODAY),
        makeExpense('m2', TODAY),
        makeExpense('t3', TODAY),
      ],
      new Set(['m1', 'm2']),
    )

    const [firstToggle, secondToggle] = screen.getAllByRole('button', {
      name: /hidden expenses? not involving you/i,
    })
    await user.click(firstToggle!)

    expect(orderedRowLabels(container)).toEqual([
      'Expense m1',
      'Show less',
      'Expense t1',
      'Expense t2',
      'Expense m2',
      '1 hidden expense not involving you',
    ])
    // The untouched run stays collapsed and keeps its test id.
    expect(secondToggle).toHaveAttribute(
      'data-testid',
      'hidden-expenses-toggle-today-1',
    )
    expect(secondToggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(screen.getByRole('button', { name: /^show less$/i }))
    expect(orderedRowLabels(container)).toEqual([
      'Expense m1',
      '2 hidden expenses not involving you',
      'Expense m2',
      '1 hidden expense not involving you',
    ])
  })

  it('expands runs of different date groups independently', async () => {
    const { user } = renderTimeline(
      [
        makeExpense('mine-today', TODAY),
        makeExpense('theirs-today', TODAY),
        makeExpense('mine-old', OLDER),
        makeExpense('theirs-old', OLDER),
      ],
      new Set(['mine-today', 'mine-old']),
    )

    const toggles = screen.getAllByRole('button', {
      name: /1 hidden expense not involving you/i,
    })
    expect(toggles).toHaveLength(2)

    await user.click(toggles[0]!)

    expect(screen.getByText('Expense theirs-today')).toBeInTheDocument()
    expect(screen.queryByText('Expense theirs-old')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /^show less$/i }),
    ).toHaveAttribute('aria-expanded', 'true')

    await user.click(screen.getByRole('button', { name: /^show less$/i }))

    expect(screen.queryByText('Expense theirs-today')).not.toBeInTheDocument()
  })

  it('renders only the toggle row when a group has no involving expenses', () => {
    renderTimeline([makeExpense('theirs', OLDER)], new Set(['someone-else']))

    expect(screen.queryByText('Expense theirs')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: /1 hidden expense not involving you/i,
      }),
    ).toBeInTheDocument()
  })

  it('collapses a lone hidden expense between involving ones', () => {
    const { container } = renderTimeline(
      [
        makeExpense('m1', TODAY),
        makeExpense('solo', TODAY),
        makeExpense('m2', TODAY),
      ],
      new Set(['m1', 'm2']),
    )

    expect(orderedRowLabels(container)).toEqual([
      'Expense m1',
      '1 hidden expense not involving you',
      'Expense m2',
    ])
  })

  it('uses inline run toggles when sorted without date grouping', () => {
    const { container } = renderTimeline(
      [
        makeExpense('mine-1', TODAY),
        makeExpense('theirs-1', TODAY),
        makeExpense('mine-2', OLDER),
        makeExpense('theirs-2', OLDER),
      ],
      new Set(['mine-1', 'mine-2']),
      { sortBy: 'amount' },
    )

    expect(orderedRowLabels(container)).toEqual([
      'Expense mine-1',
      '1 hidden expense not involving you',
      'Expense mine-2',
      '1 hidden expense not involving you',
    ])
  })

  it('resets per-run expansion when the view mode flips', async () => {
    const expenses = [makeExpense('mine', TODAY), makeExpense('theirs', TODAY)]
    const involvingIds = new Set(['mine'])
    const renderAtMode = (showAll: boolean) => (
      <ExpenseTimeline
        expenses={expenses}
        sortBy="expenseDate"
        timeZone="UTC"
        hasMore={false}
        isInvolving={(expense) => involvingIds.has(expense.id)}
        showAll={showAll}
        renderExpense={(expense) => (
          <div key={expense.id}>{`Expense ${expense.id}`}</div>
        )}
      />
    )
    const { user, rerender } = render(renderAtMode(false))

    await user.click(
      screen.getByRole('button', {
        name: /1 hidden expense not involving you/i,
      }),
    )
    expect(screen.getByText('Expense theirs')).toBeInTheDocument()

    rerender(renderAtMode(true))
    expect(
      screen.queryByRole('button', { name: /not involving you/i }),
    ).not.toBeInTheDocument()

    // Expansion did not survive the mode flip: the run is collapsed again.
    rerender(renderAtMode(false))
    expect(screen.queryByText('Expense theirs')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: /1 hidden expense not involving you/i,
      }),
    ).toHaveAttribute('aria-expanded', 'false')
  })

  it('marks collapsed runs with the EyeOff icon', () => {
    const { container } = renderTimeline(
      [makeExpense('mine', TODAY), makeExpense('theirs', TODAY)],
      new Set(['mine']),
    )

    const toggle = screen.getByRole('button', {
      name: /1 hidden expense not involving you/i,
    })
    expect(toggle.querySelector('svg.lucide-eye-off')).not.toBeNull()
    expect(container.querySelector('svg.lucide-more-vertical')).toBeNull()
  })
})
