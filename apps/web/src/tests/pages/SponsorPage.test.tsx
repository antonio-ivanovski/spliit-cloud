import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import SponsorPage from '@/app/sponsor'
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

const EVM_ADDRESS = '0x3B1490F2dAF01FF3BdeE1868087f189AEa027bFf'
const BTC_ADDRESS =
  'bc1qhkf4snvtzj0723tj2g8ryfmyhntdvy7fu66mzx6wwafl83u94njqnq2jtw'
const LIGHTNING_ADDRESS = 'purplecoil09@walletofsatoshi.com'

describe('SponsorPage', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders the GitHub Sponsors option and all crypto addresses', () => {
    render(<SponsorPage />)

    expect(
      screen.getByRole('heading', { name: 'Support Spliit Cloud' }),
    ).toBeInTheDocument()

    const sponsorLink = screen.getByRole('link', { name: 'Become a sponsor' })
    expect(sponsorLink).toHaveAttribute(
      'href',
      'https://github.com/sponsors/antonio-ivanovski',
    )
    expect(sponsorLink).toHaveAttribute('target', '_blank')
    expect(sponsorLink).toHaveAttribute('rel', 'noopener noreferrer')

    expect(screen.getByText(EVM_ADDRESS)).toBeVisible()
    expect(screen.getByText(BTC_ADDRESS)).toBeVisible()
    expect(screen.getByText(LIGHTNING_ADDRESS)).toBeVisible()
    expect(screen.getByText('Crypto donations are irreversible')).toBeVisible()
  })

  it('links other EVM tokens and general questions to the contact email', () => {
    render(<SponsorPage />)

    const evmContactLink = screen.getByRole('link', { name: 'Ask us first' })
    expect(evmContactLink).toHaveAttribute(
      'href',
      'mailto:contact@spliit.cloud',
    )

    expect(
      screen.getByRole('heading', {
        name: 'Donated, or want another way to give?',
      }),
    ).toBeInTheDocument()
    const emailLink = screen.getByRole('link', {
      name: 'contact@spliit.cloud',
    })
    expect(emailLink).toHaveAttribute('href', 'mailto:contact@spliit.cloud')

    expect(
      screen.getByRole('link', { name: 'Share feedback' }),
    ).toHaveAttribute('href', '/feedback')
  })

  it('copies the selected address', async () => {
    const user = userEvent.setup()
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined)
    render(<SponsorPage />)

    const copyButtons = screen.getAllByRole('button', { name: 'Copy address' })
    expect(copyButtons).toHaveLength(3)
    await user.click(copyButtons[1])

    expect(writeText).toHaveBeenCalledWith(BTC_ADDRESS)
    expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible()
  })

  it('keeps the address selectable when clipboard access fails', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
      new Error('denied'),
    )
    render(<SponsorPage />)

    const copyButtons = screen.getAllByRole('button', { name: 'Copy address' })
    await user.click(copyButtons[0])

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Clipboard access failed. Select and copy the address manually.',
    )
    expect(screen.getByText(EVM_ADDRESS)).toBeVisible()
  })
})
