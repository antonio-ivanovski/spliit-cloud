import { describe, expect, it, vi } from 'vitest'

import { ArtFooter } from '@/components/footer/ArtFooter'
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

describe('ArtFooter', () => {
  it('renders the simple paper footer without brand mark', () => {
    render(<ArtFooter hiddenOnMobile={false} />)

    expect(screen.getByTestId('art-footer')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'source and contributors' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByAltText('Spliit')).not.toBeInTheDocument()
  })

  it('renders the five simple link buttons', () => {
    const { container } = render(<ArtFooter hiddenOnMobile={false} />)

    const links = container.querySelector(
      '[data-testid="art-footer"] .art-footer__links',
    )
    expect(links).not.toBeNull()
    expect(links?.querySelectorAll('a')).toHaveLength(5)
    expect(screen.getByText('GitHub').closest('a')).toHaveAttribute(
      'href',
      'https://github.com/antonio-ivanovski/spliit-cloud',
    )
  })

  it('fuses the made-with-love note with the sponsor button', () => {
    const { container } = render(<ArtFooter hiddenOnMobile={false} />)

    const credit = container.querySelector(
      '[data-testid="art-footer"] .art-footer__credit',
    )
    expect(credit).not.toBeNull()
    expect(credit).toHaveTextContent(
      'Made by the open-source community with love',
    )
    const sponsor = screen.getByRole('link', { name: 'Sponsor' })
    expect(sponsor).toHaveAttribute('href', '/sponsor')
    expect(credit).toContainElement(sponsor)
    expect(sponsor).toHaveClass('art-footer__link--warm')
  })

  it('keeps legal navigation and GitHub reachable', () => {
    render(<ArtFooter hiddenOnMobile={false} />)

    expect(
      screen.getByRole('navigation', { name: 'Legal links' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute(
      'href',
      '/privacy',
    )
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute(
      'href',
      '/terms',
    )
    expect(screen.getByText('GitHub').closest('a')).toHaveAttribute(
      'href',
      'https://github.com/antonio-ivanovski/spliit-cloud',
    )
  })

  it('hides on mobile app routes when asked', () => {
    const { rerender } = render(<ArtFooter hiddenOnMobile />)
    expect(screen.getByTestId('art-footer')).toHaveClass('hidden')

    rerender(<ArtFooter hiddenOnMobile={false} />)
    expect(screen.getByTestId('art-footer')).not.toHaveClass('hidden')
  })
})
