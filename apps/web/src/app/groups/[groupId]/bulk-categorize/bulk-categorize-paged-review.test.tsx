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
  },
}))

vi.mock('react-intersection-observer', () => ({
  useInView: () => ({ ref: () => undefined, inView: false }),
}))

vi.mock('./bulk-categorize-table', () => ({
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
}))

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

  it('shows a clear finish state when every row has a category', () => {
    mocks.reviewPage.mockReturnValue({
      data: undefined,
      isFetching: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
    })
    render(
      <BulkCategorizePagedReview
        groupId="group-1"
        runId="run-1"
        reviewCycle="cycle-1"
        total={0}
        filter="general"
        disabled={false}
        aiMinConfidence={0.5}
        onChange={async () => true}
      />,
    )
    expect(
      screen.getByText('No expenses are left in General in this review.'),
    ).toBeInTheDocument()
  })
})
