import { describe, expect, it, vi } from 'vitest'

import { render, screen, userEvent } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  reviewPage: vi.fn(),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    ai: {
      bulkCategorize: { reviewPage: { useInfiniteQuery: mocks.reviewPage } },
    },
    groups: {
      expenses: {
        series: {
          useQuery: () => ({ data: { series: [] } }),
        },
      },
    },
  },
}))

vi.mock('react-intersection-observer', () => ({
  useInView: () => ({ ref: () => undefined, inView: false }),
}))

import type { groupSeriesRows } from './bulk-categorize-table'

vi.mock('./bulk-categorize-table', async (importOriginal) => {
  const actual = await importOriginal<{
    groupSeriesRows: typeof groupSeriesRows
  }>()
  return {
    ...actual,
    groupSeriesRows: (...args: Parameters<typeof actual.groupSeriesRows>) => {
      // The review only surfaces groups in the save path; keep the table
      // mock row-focused without losing the grouping contract.
      if (args[0].length > 0) return actual.groupSeriesRows(...args)
      return []
    },
    BulkCategorizeTable: ({
      rows,
      onChange,
    }: {
      rows: Array<{ id: string; title: string }>
      onChange: (id: string, categoryId: string) => void
    }) => (
      <div>
        {rows.map((row) => (
          <button key={row.id} onClick={() => onChange(row.id, 'groceries')}>
            {row.title}
          </button>
        ))}
      </div>
    ),
  }
})

import { BulkCategorizePagedReview } from './bulk-categorize-paged-review'

describe('General-only categorization review', () => {
  it('removes a successfully assigned row without changing the saved review order', async () => {
    mocks.reviewPage.mockReturnValue({
      data: {
        pages: [
          {
            total: 2,
            rows: [
              { id: 'one', title: 'First', categoryId: 'general' },
              { id: 'two', title: 'Second', categoryId: 'general' },
            ],
          },
        ],
      },
      isFetching: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
    })
    const onChange = vi.fn(async () => true)
    const user = userEvent.setup()
    render(
      <BulkCategorizePagedReview
        groupId="group-1"
        runId="run-1"
        reviewCycle="cycle-1"
        total={2}
        filter="general"
        remoteReviewVersion={0}
        disabled={false}
        aiMinConfidence={0.5}
        onChange={onChange}
      />,
    )

    expect(
      screen.getAllByRole('button').map((button) => button.textContent),
    ).toEqual(['First', 'Second'])
    await user.click(screen.getByRole('button', { name: 'First' }))
    expect(
      screen.queryByRole('button', { name: 'First' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Second' })).toBeInTheDocument()
    expect(onChange).toHaveBeenCalledWith('one', 'groceries')
    expect(mocks.reviewPage).toHaveBeenCalledWith(
      {
        groupId: 'group-1',
        runId: 'run-1',
        reviewCycle: 'cycle-1',
        filter: 'general',
        limit: 100,
      },
      expect.any(Object),
    )
  })

  it('reports recurring series groups with cadence and divergence', async () => {
    const { groupSeriesRows } = await import('./bulk-categorize-table')
    expect(
      groupSeriesRows([
        {
          id: 'one',
          title: 'Rent',
          expenseDate: '2026-01-01',
          amount: 100,
          currency: 'USD',
          categoryId: 'groceries',
          initialCategoryId: 'general',
          recurringSeriesId: 'series-1',
          recurrenceSequence: 1,
          choices: [],
        },
        {
          id: 'two',
          title: 'Rent',
          expenseDate: '2026-02-01',
          amount: 100,
          currency: 'USD',
          categoryId: 'groceries',
          initialCategoryId: 'general',
          recurringSeriesId: 'series-1',
          recurrenceSequence: 2,
          choices: [],
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        seriesId: 'series-1',
        title: 'Rent',
        selectedCount: 2,
        rowCount: 2,
        diverged: false,
      }),
    ])
  })
})
