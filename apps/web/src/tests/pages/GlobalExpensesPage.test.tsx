import { describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({ useSearch: () => ({}) }),
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="/expenses">{children}</a>
  ),
  useNavigate: () => mocks.navigate,
}))

vi.mock('react-intersection-observer', () => ({
  useInView: () => ({ ref: vi.fn(), inView: false }),
}))

vi.mock('@/components/account-preferences-sync', () => ({
  useSyncedAccountPreferences: () => ({ timeZone: 'UTC' }),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    expenses: {
      filterOptions: {
        useQuery: () => ({
          data: { groups: [], people: [], categories: [], currencies: [] },
          error: null,
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      list: {
        useInfiniteQuery: () => ({
          data: { pages: [{ expenses: [], hasMore: false }] },
          error: null,
          isFetching: false,
          isLoading: false,
          fetchNextPage: vi.fn(),
          refetch: vi.fn(),
        }),
      },
    },
  },
}))

import { GlobalExpensesContent } from '@/app/expenses/page'

describe('GlobalExpensesContent', () => {
  it('uses the continuous scan surface without a hidden mobile header gap', () => {
    render(<GlobalExpensesContent />)

    const search = screen.getByPlaceholderText(/search for an expense/i)
    const surface = search.closest('[data-scan-surface]')
    expect(surface).toHaveClass('-mx-1', 'sm:rounded-lg', 'sm:bg-card')

    const title = screen.getByText('All expenses')
    expect(title.parentElement).toHaveClass('hidden', 'sm:block', 'sm:p-6')
    expect(title.parentElement).not.toHaveClass('p-4')
  })
})
