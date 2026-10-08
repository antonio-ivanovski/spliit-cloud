import { describe, expect, it, vi } from 'vitest'

import { NotFoundPage } from '@/components/not-found-page'
import { render, screen } from '@/test/test-utils'

// ── Module mocks ────────────────────────────────────────────────────────

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

// ── Tests ───────────────────────────────────────────────────────────────

describe('NotFoundPage', () => {
  it('renders the generic not-found copy by default', () => {
    render(<NotFoundPage showBackButton={false} />)

    expect(screen.getByText('Page not found')).toBeInTheDocument()
    expect(
      screen.getByText(
        "The page you're looking for doesn't exist or has been moved.",
      ),
    ).toBeInTheDocument()
  })

  it('renders a link back to home', () => {
    render(<NotFoundPage showBackButton={false} />)

    const link = screen.getByText('Go to home')
    expect(link).toBeInTheDocument()
    expect(link.closest('a')).toHaveAttribute('href', '/')
  })

  it('renders custom resource copy without a home link', () => {
    render(
      <NotFoundPage
        title="Expense not found"
        description="This expense doesn't exist or was deleted."
        showHomeLink={false}
        showBackButton={false}
      />,
    )

    expect(screen.getByText('Expense not found')).toBeInTheDocument()
    expect(screen.queryByText('Go to home')).not.toBeInTheDocument()
  })

  it('calls onBack when the back button is pressed', async () => {
    const onBack = vi.fn()
    const { user } = render(
      <NotFoundPage showHomeLink={false} onBack={onBack} />,
    )

    await user.click(screen.getByText('Go back'))

    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('renders a retry action when onRetry is provided', async () => {
    const onRetry = vi.fn()
    const { user } = render(
      <NotFoundPage
        showHomeLink={false}
        showBackButton={false}
        onRetry={onRetry}
      />,
    )

    await user.click(screen.getByText('Try again'))

    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
