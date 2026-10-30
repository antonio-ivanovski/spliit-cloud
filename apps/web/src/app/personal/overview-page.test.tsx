import { describe, expect, it, vi } from 'vitest'

import { PersonalOverviewView } from '@/app/personal/page-overview'
import type { PersonalEntry, PersonalOverview } from '@/app/personal/types'
import { render, screen } from '@/test/test-utils'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => (
    <a href={to}>{children}</a>
  ),
}))

vi.mock('@/app/personal/api', () => ({
  usePersonalProfile: () => ({
    data: { currencyCode: 'USD', timeZone: 'UTC', sharedEnabled: true },
    isPending: false,
    isError: false,
  }),
  usePersonalRecurringUpcoming: () => ({
    data: { occurrences: [] },
    isPending: false,
    isError: false,
  }),
  useCreatePersonalTransaction: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useSuggestPersonalCategory: () => ({
    mutateAsync: vi.fn().mockResolvedValue({
      categoryId: null,
      candidates: [],
    }),
    isPending: false,
  }),
}))

function entry(overrides: Partial<PersonalEntry> = {}): PersonalEntry {
  return {
    id: 'entry-1',
    kind: 'EXPENSE',
    amount: -2500,
    currencyCode: 'USD',
    originalAmount: null,
    originalCurrency: null,
    date: '2026-10-20',
    categoryId: 'groceries',
    title: 'Weekly shop',
    note: null,
    version: 1,
    source: 'PERSONAL',
    group: null,
    canEdit: true,
    attachments: [],
    recurring: null,
    ...overrides,
  }
}

function overview(overrides: Partial<PersonalOverview> = {}): PersonalOverview {
  return {
    month: '2026-10',
    currencyCode: 'USD',
    spent: 12500,
    income: 200000,
    net: 187500,
    previousSpent: 10000,
    delta: 2500,
    categories: [
      { categoryId: 'groceries', amount: 8000, percentage: 0.64 },
      { categoryId: 'dining-out', amount: 4500, percentage: 0.36 },
    ],
    recent: [
      entry(),
      entry({
        id: 'entry-2',
        amount: -3000,
        source: 'GROUP',
        group: { id: 'group-1', name: 'Trip' },
        title: 'Hostel',
        categoryId: 'accommodation',
      }),
    ],
    budgets: [
      {
        id: 'budget-1',
        name: 'Monthly food',
        amount: 20000,
        currencyCode: 'USD',
        categoryScope: 'SELECTED',
        categoryIds: ['groceries'],
        spent: 7500,
        remaining: 12500,
        ratio: 0.375,
        projected: 11000,
        state: 'OK',
      },
    ],
    overallBudget: {
      id: 'overall',
      name: 'Overall',
      amount: 50000,
      currencyCode: 'USD',
      categoryScope: 'ALL',
      categoryIds: [],
      spent: 9900,
      remaining: 40100,
      ratio: 0.198,
      projected: 15000,
      state: 'OK',
    },
    shared: {
      enabled: true,
      count: 1,
      amount: 3000,
      groups: [{ groupId: 'group-1', name: 'Trip', count: 1, amount: 3000 }],
    },
    ...overrides,
  }
}

describe('PersonalOverviewView', () => {
  it('renders the empty state with both CTAs when there is no data', async () => {
    const { user } = render(
      <PersonalOverviewView
        overview={overview({
          spent: 0,
          income: 0,
          net: 0,
          delta: 0,
          categories: [],
          recent: [],
          budgets: [],
          overallBudget: null,
          shared: { enabled: false, count: 0, amount: 0, groups: [] },
        })}
        month="2026-10"
        onMonthChange={vi.fn()}
      />,
    )

    expect(screen.getByText('Nothing here yet')).toBeInTheDocument()
    const addButtons = screen.getAllByRole('button', { name: 'Add expense' })
    expect(addButtons.length).toBeGreaterThan(0)
    expect(
      screen.getByRole('link', { name: 'Include group expenses' }),
    ).toBeInTheDocument()

    // The add CTA opens the quick-add dialog.
    await user.click(addButtons[0]!)
    expect(
      screen.getByRole('dialog', { name: 'Add expense' }),
    ).toBeInTheDocument()
  })

  it('renders hero totals, donut categories, budgets, shared groups, and recent entries', () => {
    render(
      <PersonalOverviewView
        overview={overview()}
        month="2026-10"
        onMonthChange={vi.fn()}
      />,
    )

    // Hero: spent + income + net.
    expect(screen.getByText('$125.00')).toBeInTheDocument()
    expect(screen.getByText('+$2,000.00')).toBeInTheDocument()
    expect(screen.getByText('+$1,875.00')).toBeInTheDocument()
    // Overall budget shows its own spent figure.
    expect(screen.getByText('$99.00')).toBeInTheDocument()

    // Category donut rows carry amounts and percentages.
    expect(screen.getByText('$80.00')).toBeInTheDocument()
    expect(screen.getByText('64%')).toBeInTheDocument()

    // Budgets with spent/limit and remaining copy.
    expect(screen.getByText('Monthly food')).toBeInTheDocument()
    expect(screen.getByText('$125.00 left')).toBeInTheDocument()

    // Shared card: count, per-group row, and the Shared badge on the row.
    expect(screen.getByText('1 shared expenses')).toBeInTheDocument()
    expect(screen.getAllByText('Trip').length).toBeGreaterThan(0)
    expect(screen.getByText('Shared')).toBeInTheDocument()

    // Recent entries.
    expect(screen.getByText('Weekly shop')).toBeInTheDocument()
    expect(screen.getByText('Hostel')).toBeInTheDocument()
  })

  it('prompts to enable shared expenses when the master switch is off', () => {
    render(
      <PersonalOverviewView
        overview={overview({
          shared: { enabled: false, count: 0, amount: 0, groups: [] },
        })}
        month="2026-10"
        onMonthChange={vi.fn()}
      />,
    )

    expect(
      screen.getByText('Group expenses aren’t included yet.'),
    ).toBeInTheDocument()
  })
})
