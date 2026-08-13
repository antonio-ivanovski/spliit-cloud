import { describe, expect, it, vi } from 'vitest'

import {
  SeriesControls,
  type ExpenseSeriesMetadata,
} from '@/app/groups/[groupId]/expenses/series-controls'
import { render, screen } from '@/test/test-utils'

vi.mock('@/app/groups/[groupId]/use-link-invite-token', () => ({
  useLinkInviteToken: vi.fn(() => undefined),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    search,
    children,
    ...props
  }: {
    to: string
    search?: { seriesId?: string; invite?: string }
    children?: React.ReactNode
    [key: string]: unknown
  }) => {
    const params = new URLSearchParams()
    if (search?.seriesId) params.set('seriesId', search.seriesId)
    if (search?.invite) params.set('invite', search.invite)
    const query = params.toString()
    return (
      <a href={query ? `${to}?${query}` : to} {...props}>
        {children}
      </a>
    )
  },
}))

function makeSeries(
  overrides: Partial<ExpenseSeriesMetadata> = {},
): ExpenseSeriesMetadata {
  return {
    id: 'series-1',
    sequence: 2,
    status: 'ACTIVE',
    previousExpenseId: 'exp-prev',
    nextExpenseId: 'exp-next',
    ...overrides,
  }
}

describe('SeriesControls', () => {
  it('renders the Previous and Next controls as links when ids are set', () => {
    render(<SeriesControls groupId="g1" series={makeSeries()} />)

    const previousLink = screen.getByRole('link', { name: /previous/i })
    expect(previousLink).toHaveAttribute(
      'href',
      '/groups/$groupId/expenses/$expenseId',
    )

    const nextLink = screen.getByRole('link', { name: /next/i })
    expect(nextLink).toHaveAttribute(
      'href',
      '/groups/$groupId/expenses/$expenseId',
    )
  })

  it('renders the Previous and Next controls as disabled buttons when ids are null', () => {
    render(
      <SeriesControls
        groupId="g1"
        series={makeSeries({
          previousExpenseId: null,
          nextExpenseId: null,
        })}
      />,
    )

    const previousButton = screen.getByRole('button', { name: /previous/i })
    expect(previousButton).toBeDisabled()
    expect(previousButton.tagName).toBe('BUTTON')

    const nextButton = screen.getByRole('button', { name: /next/i })
    expect(nextButton).toBeDisabled()
    expect(nextButton.tagName).toBe('BUTTON')

    expect(screen.queryByRole('link', { name: /previous/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /next/i })).toBeNull()
  })

  it('renders "View series" as a button calling onViewSeries when provided', async () => {
    const onViewSeries = vi.fn()
    const { user } = render(
      <SeriesControls
        groupId="g1"
        series={makeSeries()}
        onViewSeries={onViewSeries}
      />,
    )

    const button = screen.getByRole('button', { name: /view series/i })
    expect(button.tagName).toBe('BUTTON')
    expect(screen.queryByRole('link', { name: /view series/i })).toBeNull()

    await user.click(button)
    expect(onViewSeries).toHaveBeenCalledTimes(1)
  })

  it('renders "View series" as a link to the series query when onViewSeries is omitted', () => {
    render(<SeriesControls groupId="g1" series={makeSeries()} />)

    const link = screen.getByRole('link', { name: /view series/i })
    expect(link).toHaveAttribute(
      'href',
      '/groups/$groupId/expenses?seriesId=series-1',
    )
  })

  it('renders the RecurringBadge for the given status', () => {
    render(
      <SeriesControls
        groupId="g1"
        series={makeSeries({ status: 'CANCELLED' })}
      />,
    )

    expect(screen.getByText('Recurring · Stopped')).toBeInTheDocument()
  })
})
