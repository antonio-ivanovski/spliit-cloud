import { Cloud, Plus, Users } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...props
  }: {
    to: string
    children: React.ReactNode
    [key: string]: unknown
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

import { CreateCard } from '@/app/groups/create-card'

describe('CreateCard', () => {
  it('renders a link to the create page with the title and description', () => {
    render(
      <CreateCard
        to="/groups/create"
        icon={<Plus data-testid="icon" />}
        title="Create a group"
        description="Add friends and split expenses"
      />,
    )
    const link = screen.getByRole('link', {
      name: /create a group/i,
    }) as HTMLAnchorElement
    expect(link).toBeInTheDocument()
    expect(link.getAttribute('href')).toBe('/groups/create')
    expect(
      screen.getByText('Add friends and split expenses'),
    ).toBeInTheDocument()
  })

  it('renders a custom data-testid when provided', () => {
    render(
      <CreateCard
        to="/friends/create"
        icon={<Users data-testid="icon" />}
        title="Create a friend ledger"
        description="Track 1-on-1 expenses with someone"
        data-testid="create-friend-ledger-card"
      />,
    )
    const link = screen.getByTestId(
      'create-friend-ledger-card',
    ) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/friends/create')
  })

  it('renders a secondary action zone when provided', () => {
    render(
      <CreateCard
        to="/groups/create"
        icon={<Plus data-testid="icon" />}
        title="Create a group"
        description="Add friends and split expenses"
        secondaryAction={{
          to: '/groups/import',
          icon: <Cloud data-testid="import-icon" />,
          label: 'Import',
          'data-testid': 'import-group-action',
        }}
      />,
    )
    const primary = screen.getByRole('link', {
      name: /create a group/i,
    }) as HTMLAnchorElement
    expect(primary.getAttribute('href')).toBe('/groups/create')

    const secondary = screen.getByTestId(
      'import-group-action',
    ) as HTMLAnchorElement
    expect(secondary.getAttribute('href')).toBe('/groups/import')
    expect(screen.getByText('Import')).toBeInTheDocument()
  })

  it('does not render a secondary action zone when not provided', () => {
    render(
      <CreateCard
        to="/friends/create"
        icon={<Users data-testid="icon" />}
        title="Create a friend ledger"
        description="Track 1-on-1 expenses with someone"
      />,
    )
    expect(screen.queryByTestId('import-group-action')).not.toBeInTheDocument()
  })

  it('matches the GroupCard minimum height (min-h-[5.5rem])', () => {
    const { container } = render(
      <CreateCard
        to="/groups/create"
        icon={<Plus data-testid="icon" />}
        title="Create a group"
        description="Add friends and split expenses"
      />,
    )
    // The card wrapper carries the min-height class shared with GroupCard
    const wrapper = container.querySelector('div.min-h-\\[5\\.5rem\\]')
    expect(wrapper).not.toBeNull()
  })
})
