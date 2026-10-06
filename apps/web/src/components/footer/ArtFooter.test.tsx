import { afterEach, describe, expect, it, vi } from 'vitest'

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

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('ArtFooter', () => {
  it('renders the simple paper footer without brand mark', () => {
    render(<ArtFooter hiddenOnMobile={false} />)

    expect(screen.getByTestId('art-footer')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'source and contributors' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByAltText('Spliit')).not.toBeInTheDocument()
  })

  it('renders the four legal link buttons without GitHub', () => {
    vi.stubEnv('VITE_STATUS_PAGE_URL', '')
    const { container } = render(<ArtFooter hiddenOnMobile={false} />)

    const links = container.querySelector(
      '[data-testid="art-footer"] .art-footer__links',
    )
    expect(links).not.toBeNull()
    expect(links?.querySelectorAll('a')).toHaveLength(4)
    expect(links).not.toHaveTextContent('open-source community')
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

  it('links the open-source community note to GitHub with its icon', () => {
    const { container } = render(<ArtFooter hiddenOnMobile={false} />)

    const credit = container.querySelector(
      '[data-testid="art-footer"] .art-footer__credit',
    )
    const github = screen.getByRole('link', {
      name: 'open-source community',
    })
    expect(github).toHaveAttribute(
      'href',
      'https://github.com/antonio-ivanovski/spliit-cloud',
    )
    expect(github).toHaveAttribute('target', '_blank')
    expect(github).toHaveClass('art-footer__credit-link')
    expect(credit).toContainElement(github)
    expect(github.querySelector('img')).not.toBeNull()
  })

  it('keeps legal navigation reachable', () => {
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
  })

  it('shows a status pill linking to the status page when configured', () => {
    vi.stubEnv('VITE_STATUS_PAGE_URL', 'https://status.spliit.cloud/')
    const { container } = render(<ArtFooter hiddenOnMobile={false} />)

    const status = screen.getByRole('link', { name: 'Status' })
    expect(status).toHaveAttribute('href', 'https://status.spliit.cloud/')
    expect(status).toHaveAttribute('target', '_blank')
    const links = container.querySelector(
      '[data-testid="art-footer"] .art-footer__links',
    )
    expect(links).toContainElement(status)
  })

  it('hides the status pill when no status page is configured', () => {
    vi.stubEnv('VITE_STATUS_PAGE_URL', '')
    render(<ArtFooter hiddenOnMobile={false} />)

    expect(
      screen.queryByRole('link', { name: 'Status' }),
    ).not.toBeInTheDocument()
  })

  it('hides on mobile app routes when asked', () => {
    const { rerender } = render(<ArtFooter hiddenOnMobile />)
    expect(screen.getByTestId('art-footer')).toHaveClass('hidden')

    rerender(<ArtFooter hiddenOnMobile={false} />)
    expect(screen.getByTestId('art-footer')).not.toHaveClass('hidden')
  })
})
