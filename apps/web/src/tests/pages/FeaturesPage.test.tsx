import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import FeaturesPage from '@/app/features/page'
import { render, screen } from '@/test/test-utils'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...props
  }: {
    to: string
    children?: React.ReactNode
    [key: string]: unknown
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

describe('FeaturesPage', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders the hero, live demo, and full catalog', () => {
    render(<FeaturesPage />)

    expect(
      screen.getByRole('heading', {
        name: 'Everything you need to split expenses',
      }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('split-settle-demo')).toBeInTheDocument()
    // Default: $90 paid by Alex, split equally.
    expect(screen.getByTestId('demo-balance-alex')).toHaveTextContent('+$60.00')
    expect(screen.getByTestId('demo-settlements')).toHaveTextContent(
      'Blake → Alex',
    )
    // Spot-check catalog coverage from auth basics to batch tools.
    expect(screen.getByText('Anonymous accounts')).toBeInTheDocument()
    expect(screen.getByText('Bulk AI categorization')).toBeInTheDocument()
    expect(screen.getByText('API, MCP, OAuth & webhooks')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Get started' })).toHaveAttribute(
      'href',
      '/',
    )
  })

  it('updates settlements when the payer changes', async () => {
    const user = userEvent.setup()
    render(<FeaturesPage />)

    await user.click(screen.getByTestId('demo-payer-blake'))

    expect(screen.getByTestId('demo-balance-blake')).toHaveTextContent(
      '+$60.00',
    )
    expect(screen.getByTestId('demo-settlements')).toHaveTextContent(
      'Alex → Blake',
    )
  })

  it('supports custom share weights', async () => {
    const user = userEvent.setup()
    render(<FeaturesPage />)

    await user.click(screen.getByTestId('demo-mode-custom'))
    const alexWeight = screen.getByTestId('demo-weight-alex')
    await user.clear(alexWeight)
    await user.type(alexWeight, '2')

    // $90 split 2:1:1 → Alex owes $45, balances shift accordingly.
    expect(screen.getByTestId('demo-balance-alex')).toHaveTextContent('+$45.00')
  })
})
