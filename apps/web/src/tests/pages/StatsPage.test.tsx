import { describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  useStatsQuery: vi.fn(() => ({
    data: {
      dashboard: {
        lifetimeTotal: 16625,
        period: {
          from: new Date('2026-08-25T00:00:00.000Z'),
          to: new Date('2026-08-25T00:00:00.000Z'),
          total: 16625,
          expenseCount: 2,
        },
      },
    },
    error: null,
    isFetching: false,
    refetch: vi.fn(),
  })),
}))

vi.mock('@/app/groups/[groupId]/current-group-context', () => ({
  useCurrentGroup: () => ({
    groupId: 'group-1',
    group: { currency: '$', currencyCode: 'USD' },
  }),
}))

vi.mock('@/app/groups/[groupId]/use-group-access-search', () => ({
  useGroupAccessSearch: () => ({
    linkInviteToken: undefined,
    viewKey: undefined,
  }),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    groups: {
      stats: {
        get: { useQuery: mocks.useStatsQuery },
      },
    },
  },
}))

vi.mock('@/lib/use-online-status', () => ({
  useOfflineWithoutData: () => false,
}))

vi.mock('@/app/groups/[groupId]/stats/period-picker', () => ({
  StatsPeriodPicker: () => <div data-testid="period-picker" />,
}))

vi.mock('@/app/groups/[groupId]/stats/spending-chart', () => ({
  SpendingChart: () => <div data-testid="spending-chart" />,
}))

vi.mock('@/app/groups/[groupId]/stats/category-breakdown', () => ({
  CategoryBreakdown: () => <div data-testid="category-breakdown" />,
}))

vi.mock('@/app/groups/[groupId]/stats/participant-breakdown', () => ({
  ParticipantBreakdown: () => <div data-testid="participant-breakdown" />,
}))

import { StatsDashboard } from '@/app/groups/[groupId]/stats/dashboard'
import { TotalsPageClient } from '@/app/groups/[groupId]/stats/page.client'

describe('Stats mobile surface hierarchy', () => {
  it('renders the page heading outside a card wrapper', () => {
    render(<TotalsPageClient />)

    const heading = screen.getByTestId('stats-page-heading')
    expect(heading.parentElement).toHaveClass('px-[var(--page-inset,1rem)]')
    expect(heading.closest('.bg-card')).toBeNull()
  })

  it('renders each dashboard section as an independent card', () => {
    const { container } = render(<StatsDashboard />)
    const surfaces = container.querySelectorAll('[data-stats-surface]')

    expect(surfaces).toHaveLength(6)
    surfaces.forEach((surface) => {
      expect(surface.parentElement?.closest('[data-stats-surface]')).toBeNull()
      expect(surface).toHaveClass('rounded-lg', 'border', 'bg-card')
    })
  })
})
