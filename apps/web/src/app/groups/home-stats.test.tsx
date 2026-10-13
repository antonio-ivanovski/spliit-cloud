import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen, waitFor, within } from '@/test/test-utils'

import { HomeStats, type HomeStatsData } from './home-stats'

const mocks = vi.hoisted(() => ({
  fetchStats: vi.fn(),
  connectivity: 'online',
}))
vi.mock('@/trpc/client', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  return {
    trpc: {
      overview: {
        stats: {
          get: {
            useQuery: (input: unknown, options: { enabled: boolean }) =>
              useQuery({
                queryKey: ['overview-stats', input],
                queryFn: () => mocks.fetchStats(input),
                ...options,
              }),
          },
        },
      },
    },
  }
})
vi.mock('@/lib/use-online-status', () => ({
  useConnectivityStatus: () => mocks.connectivity,
}))
// Transport and controls are owned here; chart rendering has no bearing on
// whether a person's stale totals are shown under a different name.
vi.mock('./home-stats-chart', () => ({ HomeStatsChart: () => <div /> }))

const initial: HomeStatsData = {
  filters: {
    person: { kind: 'ME' },
    scope: 'ALL',
    period: 'MONTH',
    timeZone: 'UTC',
    includeArchived: true,
    includeHidden: true,
  },
  range: { from: '2026-10-01', to: '2026-10-08' },
  granularity: 'DAY',
  coverage: { eligibleLedgerCount: 2, unavailableLedgerCount: 0 },
  currencies: [
    {
      key: 'code:EUR',
      currency: '€',
      currencyCode: 'EUR',
      expenses: 42000,
      income: 10000,
      netSpending: 32000,
      transactionCount: 2,
      ledgerCount: 1,
      timeline: [
        {
          date: '2026-10-08',
          expenses: 42000,
          income: 10000,
          netSpending: 32000,
        },
      ],
      categories: [],
      ledgers: [],
    },
    {
      key: 'code:USD',
      currency: '$',
      currencyCode: 'USD',
      expenses: 8000,
      income: 0,
      netSpending: 8000,
      transactionCount: 1,
      ledgerCount: 1,
      timeline: [],
      categories: [],
      ledgers: [],
    },
  ],
  people: [{ accountId: 'alex', name: 'Alex' }],
  groups: [{ groupId: 'trip', name: 'Trip', groupType: 'GROUP' }],
}

describe('homepage statistics', () => {
  beforeEach(() => {
    mocks.fetchStats.mockReset()
    mocks.connectivity = 'online'
  })

  it('uses the overview response without another fetch and switches currencies locally', async () => {
    const { user } = render(<HomeStats initial={initial} />)
    expect(screen.getByText('€420.00')).toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Currency' }))
    await user.click(await screen.findByRole('option', { name: 'USD' }))
    expect(screen.getAllByText('$80.00')).toHaveLength(2)
    expect(screen.queryByText('€420.00')).not.toBeInTheDocument()
    expect(mocks.fetchStats).not.toHaveBeenCalled()
  })

  it('clears the previous person’s totals while fetching and displays only the selected person’s response', async () => {
    let resolve!: (value: HomeStatsData) => void
    mocks.fetchStats.mockReturnValue(
      new Promise<HomeStatsData>((done) => {
        resolve = done
      }),
    )
    const { user } = render(<HomeStats initial={initial} />)
    await user.click(screen.getByRole('combobox', { name: 'Person' }))
    await user.click(await screen.findByRole('option', { name: 'Alex' }))
    expect(screen.queryByText('€420.00')).not.toBeInTheDocument()
    expect(screen.getByText('Updating statistics…')).toBeInTheDocument()
    resolve({
      ...initial,
      filters: {
        ...initial.filters,
        person: { kind: 'ACCOUNT', accountId: 'alex' },
      },
      currencies: [
        {
          ...initial.currencies[0],
          expenses: 12000,
          income: 0,
          netSpending: 12000,
        },
      ],
    })
    await waitFor(() => expect(screen.getAllByText('€120.00')).toHaveLength(2))
    expect(
      screen.getByText('Alex: activity in your shared ledgers only.'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Person' }))
    await user.click(await screen.findByRole('option', { name: 'Me' }))
    expect(screen.getByText('€420.00')).toBeInTheDocument()
    expect(mocks.fetchStats).toHaveBeenCalledTimes(1)
  })

  it('keeps filters available for empty periods and shows the server’s resolved range', async () => {
    mocks.fetchStats.mockResolvedValue({
      ...initial,
      range: { from: '2026-01-01', to: '2026-10-08' },
      currencies: [
        {
          ...initial.currencies[0],
          expenses: 0,
          income: 0,
          netSpending: 0,
          transactionCount: 0,
        },
      ],
    })
    const { user } = render(<HomeStats initial={initial} />)
    await user.click(screen.getByRole('button', { name: 'This year' }))
    await waitFor(() =>
      expect(
        screen.getByText('No recorded activity for these filters.'),
      ).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'This year' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByText('Jan 1, 2026 – Oct 8, 2026')).toBeInTheDocument()
  })

  it('requests the previous calendar month from the period buttons', async () => {
    mocks.fetchStats.mockImplementation((filters) =>
      Promise.resolve({
        ...initial,
        filters,
        range: { from: '2026-09-01', to: '2026-09-30' },
      }),
    )
    const { user } = render(<HomeStats initial={initial} />)
    await user.click(screen.getByRole('button', { name: 'Last month' }))
    await waitFor(() =>
      expect(mocks.fetchStats).toHaveBeenCalledWith(
        expect.objectContaining({ period: 'LAST_MONTH' }),
      ),
    )
    expect(screen.getByRole('button', { name: 'Last month' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(
      await screen.findByText('Sep 1, 2026 – Sep 30, 2026'),
    ).toBeInTheDocument()
  })

  it('selects ledgers independently with checkboxes and restores all ledgers', async () => {
    mocks.fetchStats.mockImplementation((filters) =>
      Promise.resolve({ ...initial, filters }),
    )
    const { user } = render(
      <HomeStats
        initial={{
          ...initial,
          groups: [
            ...initial.groups,
            {
              groupId: 'friend',
              name: 'Alex friend ledger',
              groupType: 'FRIEND',
            },
          ],
        }}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'More filters' }))
    const trip = screen.getByRole('checkbox', { name: 'Trip' })
    const friend = screen.getByRole('checkbox', { name: 'Alex friend ledger' })
    expect(trip).toBeChecked()
    expect(friend).toBeChecked()
    await user.click(trip)
    await waitFor(() =>
      expect(mocks.fetchStats).toHaveBeenLastCalledWith(
        expect.objectContaining({ groupIds: ['friend'] }),
      ),
    )
    expect(trip).not.toBeChecked()
    expect(friend).toBeChecked()
    await user.click(friend)
    await waitFor(() =>
      expect(mocks.fetchStats).toHaveBeenLastCalledWith(
        expect.objectContaining({ groupIds: [] }),
      ),
    )
    expect(friend).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'All ledgers' }))
    expect(trip).toBeChecked()
    expect(friend).toBeChecked()
    // Restoring defaults reuses the initial overview response.
    expect(screen.getByText('€420.00')).toBeInTheDocument()
  })

  it('distinguishes cached and incomplete totals without hiding the summaries', () => {
    mocks.connectivity = 'offline'
    render(
      <HomeStats
        initial={{
          ...initial,
          coverage: { eligibleLedgerCount: 2, unavailableLedgerCount: 1 },
        }}
      />,
    )
    const region = screen.getByRole('region', { name: 'Spending and income' })
    expect(
      within(region).getByText(
        'Showing cached statistics. Connect to refresh.',
      ),
    ).toBeInTheDocument()
    expect(
      within(region).getByText(
        'Some ledgers have no participant linked to you. Your totals may be incomplete.',
      ),
    ).toBeInTheDocument()
    expect(within(region).getByText('€420.00')).toBeInTheDocument()
  })
})
