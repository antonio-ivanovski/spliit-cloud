import { describe, expect, it, vi } from 'vitest'

import SupportPage from '@/app/support'
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

describe('SupportPage', () => {
  it('renders the contact email and help entry points', () => {
    render(<SupportPage />)

    expect(screen.getByRole('heading', { name: 'Support' })).toBeInTheDocument()

    const emailLink = screen.getByRole('link', {
      name: 'contact@spliit.cloud',
    })
    expect(emailLink).toHaveAttribute('href', 'mailto:contact@spliit.cloud')

    expect(
      screen.getByRole('link', { name: 'status.spliit.cloud' }),
    ).toHaveAttribute('href', 'https://status.spliit.cloud/')
    expect(screen.getByRole('link', { name: 'feedback page' })).toHaveAttribute(
      'href',
      '/feedback',
    )
    expect(
      screen.getByRole('link', { name: 'privacy@spliit.cloud' }),
    ).toHaveAttribute('href', 'mailto:privacy@spliit.cloud')
    expect(
      screen.getByRole('link', { name: 'security@spliit.cloud' }),
    ).toHaveAttribute('href', 'mailto:security@spliit.cloud')
  })
})
