import { afterEach, describe, expect, it, vi } from 'vitest'

import { FEATURE_SECTIONS } from '@/app/features/feature-registry'
import { FEATURE_ILLUSTRATIONS } from '@/app/features/illustrations/illustration-registry'
import FeaturesPage from '@/app/features/page'
import { render, screen } from '@/test/test-utils'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    hash,
    children,
    ...props
  }: {
    to: string
    hash?: string
    children?: React.ReactNode
    [key: string]: unknown
  }) => (
    <a href={hash ? `${to}#${hash}` : to} {...props}>
      {children}
    </a>
  ),
}))

const EXPECTED_ILLUSTRATION_IDS = FEATURE_SECTIONS.flatMap((s) =>
  s.items.map((item) => item.id),
)

describe('FeaturesPage', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('covers every catalog item with an illustration', () => {
    expect(EXPECTED_ILLUSTRATION_IDS).toHaveLength(20)
    for (const id of EXPECTED_ILLUSTRATION_IDS) {
      expect(FEATURE_ILLUSTRATIONS[id]).toBeDefined()
    }
  })

  it('renders the hero, all illustrations, and the full catalog', () => {
    const { container } = render(<FeaturesPage />)

    expect(
      screen.getByRole('heading', {
        name: 'Everything you need to split expenses',
      }),
    ).toBeInTheDocument()

    const illustrations = container.querySelectorAll(
      '[data-testid$="-illustration"]',
    )
    expect(illustrations).toHaveLength(20)
    expect(screen.getByTestId('balances-illustration')).toBeInTheDocument()
    expect(
      screen.getByTestId('expenses-splits-illustration'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('offline-app-illustration')).toBeInTheDocument()
    expect(screen.getByTestId('developers-illustration')).toBeInTheDocument()
    expect(
      screen.getByTestId('bulk-categorize-illustration'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('data-security-illustration')).toBeInTheDocument()
    expect(screen.getByTestId('notifications-illustration')).toBeInTheDocument()

    // Spot-check catalog coverage from sign-in to open source.
    expect(screen.getByText('Sign in your way')).toBeInTheDocument()
    expect(screen.getByText('Expenses & smart splits')).toBeInTheDocument()
    expect(screen.getByText('API, MCP & OAuth')).toBeInTheDocument()
    expect(screen.getByText('Installable app')).toBeInTheDocument()
    expect(screen.getByText('Bulk categorization')).toBeInTheDocument()
    expect(screen.getByText('Backups & recovery')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Manage webhooks' }),
    ).toHaveAttribute('href', '/account/settings#webhooks')
    expect(
      screen.getByRole('link', { name: 'Notification settings' }),
    ).toHaveAttribute('href', '/account/settings#notifications')
    expect(
      screen
        .getByRole('link', { name: 'Browse API docs' })
        .getAttribute('href'),
    )?.toMatch(/\/docs$/)
    expect(
      screen.getByRole('link', { name: 'View on GitHub' }),
    ).toHaveAttribute(
      'href',
      'https://github.com/antonio-ivanovski/spliit-cloud',
    )
    expect(screen.getByRole('link', { name: 'Get started' })).toHaveAttribute(
      'href',
      '/',
    )
  })
})
