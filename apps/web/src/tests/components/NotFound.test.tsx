import { render, screen } from '@/test/test-utils'
import { describe, expect, it, vi } from 'vitest'

// ── Module mocks ────────────────────────────────────────────────────────

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={to} {...props}>{children}</a>
  ),
}))

// ── SUT ─────────────────────────────────────────────────────────────────

import NotFound from '@/app/groups/not-found'

// ── Tests ───────────────────────────────────────────────────────────────

describe('NotFound', () => {
  it("renders 'not found' text", () => {
    render(<NotFound />)

    expect(
      screen.getByText('This group does not exist.'),
    ).toBeInTheDocument()
  })

  it('renders a link back to home', () => {
    render(<NotFound />)

    const link = screen.getByText('Go to home')
    expect(link).toBeInTheDocument()
    expect(link.closest('a')).toHaveAttribute('href', '/')
  })
})
