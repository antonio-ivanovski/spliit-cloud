import { describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  search: {} as Record<string, string>,
  listInput: null as Record<string, unknown> | null,
}))

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({ useSearch: () => mocks.search }),
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

const testGroups = [
  {
    id: 'g-active',
    name: 'Trip',
    displayName: 'Trip',
    archived: false,
    hidden: false,
    groupType: 'GROUP',
    currency: '$',
    currencyCode: 'USD',
    participantCount: 2,
  },
  {
    id: 'g-archived',
    name: 'Old trip',
    displayName: 'Old trip',
    archived: true,
    hidden: false,
    groupType: 'GROUP',
    currency: '$',
    currencyCode: 'USD',
    participantCount: 2,
  },
  {
    id: 'g-hidden',
    name: 'Secret',
    displayName: 'Secret',
    archived: false,
    hidden: true,
    groupType: 'GROUP',
    currency: '$',
    currencyCode: 'USD',
    participantCount: 2,
  },
  {
    id: 'g-both',
    name: 'Old secret',
    displayName: 'Old secret',
    archived: true,
    hidden: true,
    groupType: 'GROUP',
    currency: '$',
    currencyCode: 'USD',
    participantCount: 2,
  },
]

vi.mock('@/trpc/client', () => ({
  trpc: {
    expenses: {
      filterOptions: {
        useQuery: () => ({
          data: { groups: testGroups, people: [], currencies: [] },
          error: null,
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      list: {
        useInfiniteQuery: (input: Record<string, unknown>) => {
          mocks.listInput = input
          return {
            data: { pages: [{ expenses: [], hasMore: false }] },
            error: null,
            isFetching: false,
            isLoading: false,
            fetchNextPage: vi.fn(),
            refetch: vi.fn(),
          }
        },
      },
    },
  },
}))

import {
  filtersToSearch,
  GlobalExpensesContent,
  readFilters,
} from '@/app/expenses/page'

function exactText(text: string) {
  return (_: string, element: Element | null) =>
    element?.tagName === 'SPAN' && element?.textContent === text
}

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

  it('labels archived and hidden groups distinctly', async () => {
    const { user } = render(<GlobalExpensesContent />)

    await user.click(screen.getByRole('button', { name: /filters/i }))

    expect(
      screen.getByText(exactText('Old trip · archived')),
    ).toBeInTheDocument()
    expect(screen.getByText(exactText('Secret · hidden'))).toBeInTheDocument()
    expect(
      screen.getByText(exactText('Old secret · archived · hidden')),
    ).toBeInTheDocument()
    expect(screen.getByText(exactText('Trip'))).toBeInTheDocument()
  })

  it('persists the archived opt-in to the URL on apply', async () => {
    mocks.navigate.mockClear()
    const { user } = render(<GlobalExpensesContent />)

    await user.click(screen.getByRole('button', { name: /filters/i }))
    const checkbox = screen.getByRole('checkbox', {
      name: 'Include archived groups',
    })
    expect(checkbox).not.toBeChecked()
    await user.click(checkbox)
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        search: expect.objectContaining({ includeArchived: 'true' }),
      }),
    )
  })

  it('disables the archived opt-in while groups are selected', async () => {
    const { user } = render(<GlobalExpensesContent />)

    await user.click(screen.getByRole('button', { name: /filters/i }))
    await user.click(screen.getByRole('checkbox', { name: /Trip/ }))

    const checkbox = screen.getByRole('checkbox', {
      name: 'Include archived groups',
    })
    expect(checkbox).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByText('Only applies when no groups are selected.'),
    ).toBeInTheDocument()
  })

  it('passes the archived scope to the expense list query', () => {
    mocks.search = {}
    render(<GlobalExpensesContent />)
    expect(mocks.listInput).toMatchObject({ includeArchived: false })

    mocks.search = { includeArchived: 'true' }
    render(<GlobalExpensesContent />)
    expect(mocks.listInput).toMatchObject({ includeArchived: true })
    mocks.search = {}
  })

  it('counts the archived opt-in only when no groups are selected', () => {
    mocks.search = { includeArchived: 'true' }
    const { unmount } = render(<GlobalExpensesContent />)
    expect(screen.getByText('1 filters active')).toBeInTheDocument()
    unmount()

    mocks.search = { groups: 'g-active', includeArchived: 'true' }
    render(<GlobalExpensesContent />)
    // The group contributes 1; the inapplicable archived flag adds nothing.
    expect(screen.getByText('1 filters active')).toBeInTheDocument()
    expect(screen.queryByText('2 filters active')).not.toBeInTheDocument()
    mocks.search = {}
  })
})

describe('global expense filter URL mapping', () => {
  it('reads the archived opt-in from search params', () => {
    expect(readFilters({}).includeArchived).toBe(false)
    expect(readFilters({ includeArchived: 'true' }).includeArchived).toBe(true)
  })

  it('omits the archived flag from the URL when off', () => {
    const search = filtersToSearch(readFilters({}))
    expect(search.includeArchived).toBeUndefined()
  })

  it('round-trips the archived flag through the URL', () => {
    const filters = readFilters({ includeArchived: 'true' })
    expect(filtersToSearch(filters).includeArchived).toBe('true')
  })
})
