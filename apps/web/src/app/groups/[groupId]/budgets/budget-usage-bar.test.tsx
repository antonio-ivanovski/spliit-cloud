import { describe, expect, it } from 'vitest'

import { BudgetUsageBar } from '@/app/groups/[groupId]/budgets/budget-usage-bar'
import { render, screen } from '@/test/test-utils'

const visual = {
  badgeVariant: 'success' as const,
  barClass: 'bg-emerald-500',
  textClass: 'text-emerald-600',
  dotClass: 'bg-emerald-500',
  iconClass: 'text-emerald-600',
}

describe('BudgetUsageBar', () => {
  it('renders a fill sized to the usage percentage with progressbar semantics', () => {
    const { container } = render(
      <BudgetUsageBar
        used={50}
        limit={100}
        daysElapsed={10}
        daysTotal={20}
        visual={visual}
      />,
    )
    const fill = container.querySelector(
      '[data-testid="budget-usage-fill"]',
    ) as HTMLDivElement | null
    expect(fill).toBeTruthy()
    expect(fill!.style.width).toBe('50%')
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '50',
    )
  })

  it('labels the fill with the used percentage', () => {
    render(
      <BudgetUsageBar
        used={50}
        limit={100}
        daysElapsed={10}
        daysTotal={20}
        visual={visual}
      />,
    )
    expect(screen.getByText('50% of the budget used')).toBeInTheDocument()
  })

  it('renders a pace marker positioned at elapsed/total days and labels it', () => {
    const { container } = render(
      <BudgetUsageBar
        used={20}
        limit={100}
        daysElapsed={10}
        daysTotal={20}
        visual={visual}
      />,
    )
    const tick = container.querySelector(
      '[data-testid="budget-usage-pace-tick"]',
    ) as HTMLDivElement | null
    expect(tick).toBeTruthy()
    expect(tick!.style.left).toBe('50%')
    expect(screen.getByText('Expected pace: day 10 of 20')).toBeInTheDocument()
  })

  it('clamps a usage overflow at 100% and keeps the pace tick visible', () => {
    const { container } = render(
      <BudgetUsageBar
        used={500}
        limit={100}
        daysElapsed={10}
        daysTotal={20}
        visual={visual}
      />,
    )
    const fill = container.querySelector(
      '[data-testid="budget-usage-fill"]',
    ) as HTMLDivElement | null
    expect(fill!.style.width).toBe('100%')
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '100',
    )
    expect(
      container.querySelector('[data-testid="budget-usage-pace-tick"]'),
    ).toBeTruthy()
  })

  it('hides the pace tick and its caption when the period is at its start', () => {
    const { container } = render(
      <BudgetUsageBar
        used={0}
        limit={100}
        daysElapsed={0}
        daysTotal={20}
        visual={visual}
      />,
    )
    expect(
      container.querySelector('[data-testid="budget-usage-pace-tick"]'),
    ).toBeNull()
    expect(screen.queryByText(/Expected pace/)).toBeNull()
  })
})
