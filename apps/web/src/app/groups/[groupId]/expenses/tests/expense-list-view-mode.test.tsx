import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  useCurrentGroupOrNull: vi.fn(),
  setFilters: vi.fn(),
}))

vi.mock('@/app/groups/[groupId]/current-group-context', () => ({
  useCurrentGroup: () => ({ groupId: 'group-1' }),
  useCurrentGroupOrNull: mocks.useCurrentGroupOrNull,
}))

import { ExpenseFiltersProvider } from '../expense-filters-context'
import { ExpenseListToolbar } from '../expense-list-toolbar'
import {
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  type ExpenseFilters,
} from '../use-expense-filters'

function renderToolbar(showAll: boolean) {
  const filters: ExpenseFilters = { ...DEFAULT_FILTERS, showAll }
  return render(
    <ExpenseFiltersProvider
      value={{
        filters,
        sort: DEFAULT_SORT,
        activeCount: 0,
        queryInput: { hideSettlements: false },
        setSort: vi.fn(),
        setFilters: mocks.setFilters,
        clearOne: vi.fn(),
        filtersOpen: false,
        setFiltersOpen: vi.fn(),
      }}
    >
      <ExpenseListToolbar />
    </ExpenseFiltersProvider>,
  )
}

describe('ExpenseListToolbar view-mode control', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useCurrentGroupOrNull.mockReturnValue({
      groupId: 'group-1',
      isLoading: false,
      currentLedgerParticipantId: 'participant-1',
    })
  })

  it('shows For you selected by default and switches to All', async () => {
    const { user } = renderToolbar(false)

    const forYou = screen.getByRole('tab', { name: 'For you' })
    const all = screen.getByRole('tab', { name: 'All' })
    expect(forYou).toHaveAttribute('aria-selected', 'true')
    expect(all).toHaveAttribute('aria-selected', 'false')

    await user.click(all)
    expect(mocks.setFilters).toHaveBeenCalledWith(
      expect.objectContaining({ showAll: true }),
    )
  })

  it('shows All selected and switches back to For you', async () => {
    const { user } = renderToolbar(true)

    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    await user.click(screen.getByRole('tab', { name: 'For you' }))
    expect(mocks.setFilters).toHaveBeenCalledWith(
      expect.objectContaining({ showAll: false }),
    )
  })

  it('hides the control when the viewer has no ledger participant', () => {
    mocks.useCurrentGroupOrNull.mockReturnValue({
      groupId: 'group-1',
      isLoading: false,
      currentLedgerParticipantId: null,
    })
    renderToolbar(false)

    expect(
      screen.queryByRole('tab', { name: 'For you' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'All' })).not.toBeInTheDocument()
  })
})
