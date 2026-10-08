import { describe, expect, it, vi } from 'vitest'

import UpdatesPage from '@/app/updates'
import UpdateDetailPage from '@/app/updates-detail'
import { render, screen } from '@/test/test-utils'

// ── Module mocks ────────────────────────────────────────────────────────

const { mockAnnouncementsListQuery, mockUpdateDetailParams } = vi.hoisted(
  () => ({
    mockAnnouncementsListQuery: vi.fn(),
    mockUpdateDetailParams: {
      announcementId: 'spliit-cloud-2-5-0',
    },
  }),
)

vi.mock('@/trpc/client', () => ({
  trpc: {
    announcements: {
      list: {
        useQuery: mockAnnouncementsListQuery,
      },
    },
  },
}))

// Render detail hrefs by substituting route params, so assertions pin the
// user-facing URLs (e.g. `/updates/<id>`).
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string
    params?: Record<string, string>
    children: React.ReactNode
    [key: string]: unknown
  }) => {
    let href = to
    for (const [key, value] of Object.entries(params ?? {})) {
      href = href.replace(`$${key}`, value)
    }
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
  getRouteApi: () => ({
    useParams: () => mockUpdateDetailParams,
  }),
}))

const listEntries = [
  { id: 'spliit-cloud-2-5-0', date: '2026-10-05' },
  { id: 'spliit-cloud-2-5-0', date: '2026-10-05' },
]

describe('UpdatesPage', () => {
  it('expands only the latest update and links older ones to detail pages', () => {
    mockAnnouncementsListQuery.mockReturnValue({ data: listEntries })

    render(<UpdatesPage />)

    expect(screen.getByRole('heading', { name: 'Updates' })).toBeInTheDocument()
    // Latest entry is fully expanded: section content appears once, even
    // though the same announcement also shows as an archive row.
    expect(screen.getByText('Activity tab is now personal')).toBeInTheDocument()
    expect(screen.getByText('Previous updates')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Spliit Cloud 2.5.0 is here' }),
    ).toHaveAttribute('href', '/updates/spliit-cloud-2-5-0')
  })

  it('renders nothing expanded while updates are loading', () => {
    mockAnnouncementsListQuery.mockReturnValue({ data: undefined })

    render(<UpdatesPage />)

    expect(screen.getByRole('heading', { name: 'Updates' })).toBeInTheDocument()
    expect(
      screen.queryByText('Spliit Cloud 2.5.0 is here'),
    ).not.toBeInTheDocument()
  })
})

describe('UpdateDetailPage', () => {
  it('renders the announcement for a valid id', () => {
    mockUpdateDetailParams.announcementId = 'spliit-cloud-2-5-0'

    render(<UpdateDetailPage />)

    expect(
      screen.getByRole('heading', { name: 'Spliit Cloud 2.5.0 is here' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Activity tab is now personal')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Back to updates' }),
    ).toHaveAttribute('href', '/updates')
  })

  it('shows a not-found page for an unknown id', () => {
    mockUpdateDetailParams.announcementId = 'no-such-announcement'

    render(<UpdateDetailPage />)

    expect(screen.getByTestId('not-found-page')).toBeInTheDocument()
    expect(
      screen.queryByText('Activity tab is now personal'),
    ).not.toBeInTheDocument()
    expect(screen.getByText('See all updates').closest('a')).toHaveAttribute(
      'href',
      '/updates',
    )
  })
})
