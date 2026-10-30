import { describe, expect, it, vi } from 'vitest'

import {
  PersonalRecurringForm,
  PersonalRecurringView,
} from '@/app/personal/page-recurring'
import type {
  PersonalRecurringSeries,
  PersonalRecurringUpcoming,
} from '@/app/personal/types'
import { render, screen } from '@/test/test-utils'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => (
    <a href={to}>{children}</a>
  ),
}))

function series(
  overrides: Partial<PersonalRecurringSeries> = {},
): PersonalRecurringSeries {
  return {
    id: 'series-1',
    status: 'ACTIVE',
    frequency: 'MONTHLY',
    interval: 1,
    anchorDate: '2026-10-01',
    nextOccurrenceDate: '2026-11-01',
    nextOccurrenceOrdinal: 2,
    endType: 'INDEFINITE',
    occurrenceLimit: null,
    endDate: null,
    occurrencesCreated: 1,
    generatedCount: 1,
    kind: 'EXPENSE',
    amount: 1200,
    currencyCode: 'USD',
    categoryId: 'groceries',
    title: 'Veg box',
    note: null,
    version: 1,
    timeZone: 'UTC',
    ...overrides,
  }
}

function upcomingItem(
  overrides: Partial<PersonalRecurringUpcoming> = {},
): PersonalRecurringUpcoming {
  return {
    seriesId: 'series-1',
    sequence: 2,
    date: '2026-11-01',
    overdue: false,
    kind: 'EXPENSE',
    amount: 1200,
    currencyCode: 'USD',
    categoryId: 'groceries',
    title: 'Veg box',
    ...overrides,
  }
}

const noop = () => {}

describe('personal recurring view', () => {
  it('renders the empty state with a create action', () => {
    render(
      <PersonalRecurringView
        series={[]}
        upcoming={[]}
        currencyCode="USD"
        onCreate={noop}
        onEdit={noop}
        onPause={noop}
        onResume={noop}
        onCancel={noop}
        onDelete={noop}
        onSkip={noop}
        pendingId={null}
      />,
    )
    expect(screen.getByText(/no planned transactions/i)).toBeTruthy()
    expect(screen.getAllByText(/upcoming/i).length).toBeGreaterThan(0)
  })

  it('lists active, paused, and finished series separately', () => {
    render(
      <PersonalRecurringView
        series={[
          series({ id: 'a', status: 'ACTIVE' }),
          series({ id: 'p', status: 'PAUSED', title: 'Paused plan' }),
          series({ id: 'c', status: 'COMPLETED', title: 'Done plan' }),
          series({ id: 'x', status: 'CANCELLED', title: 'Old plan' }),
        ]}
        upcoming={[upcomingItem({ seriesId: 'b', title: 'Upcoming veg' })]}
        currencyCode="USD"
        onCreate={noop}
        onEdit={noop}
        onPause={noop}
        onResume={noop}
        onCancel={noop}
        onDelete={noop}
        onSkip={noop}
        pendingId={null}
      />,
    )
    expect(screen.getByText('Veg box')).toBeTruthy()
    expect(screen.getByText('Paused plan')).toBeTruthy()
    expect(screen.getByText('Done plan')).toBeTruthy()
    expect(screen.getByText('Old plan')).toBeTruthy()
  })

  it('highlights overdue upcoming occurrences', () => {
    render(
      <PersonalRecurringView
        series={[series()]}
        upcoming={[
          upcomingItem({ sequence: 2, date: '2026-09-01', overdue: true }),
          upcomingItem({ sequence: 3, date: '2026-10-01', overdue: false }),
        ]}
        currencyCode="USD"
        onCreate={noop}
        onEdit={noop}
        onPause={noop}
        onResume={noop}
        onCancel={noop}
        onDelete={noop}
        onSkip={noop}
        pendingId={null}
      />,
    )
    expect(screen.getByText(/overdue/i)).toBeTruthy()
  })

  it('formats upcoming amounts in major units, not raw minor units', () => {
    render(
      <PersonalRecurringView
        series={[series()]}
        upcoming={[upcomingItem({ amount: 1200, currencyCode: 'USD' })]}
        currencyCode="USD"
        onCreate={noop}
        onEdit={noop}
        onPause={noop}
        onResume={noop}
        onCancel={noop}
        onDelete={noop}
        onSkip={noop}
        pendingId={null}
      />,
    )
    expect(screen.getAllByText(/\$12\.00/).length).toBeGreaterThan(0)
  })

  it('renders the create form with schedule fields and a preview', () => {
    const onSubmit = vi.fn()
    render(
      <PersonalRecurringForm
        currencyCode="USD"
        initial={null}
        pending={false}
        onSubmit={onSubmit}
      />,
    )
    expect(screen.getAllByLabelText(/start date/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/repeats/i)).toBeTruthy()
  })

  it('hides schedule fields when editing (immutable after creation)', () => {
    const onSubmit = vi.fn()
    render(
      <PersonalRecurringForm
        currencyCode="USD"
        initial={series()}
        pending={false}
        onSubmit={onSubmit}
      />,
    )
    expect(screen.queryByLabelText(/start date/i)).toBeNull()
    expect(screen.queryByLabelText(/repeats/i)).toBeNull()
  })
})
