import { BalancesCard } from '@/app/groups/[groupId]/balances/balances-card'
import { render, screen } from '@/test/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    search,
    params,
    ...props
  }: {
    to: string
    children: React.ReactNode
    search?: Record<string, string>
    params?: Record<string, string>
    [key: string]: unknown
  }) => {
    let href = to
    for (const [key, value] of Object.entries(params ?? {})) {
      href = href.replace(`$${key}`, value)
    }
    const query = new URLSearchParams(search)
    if (query.size > 0) href += `?${query.toString()}`
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
}))

const EUR = { code: 'EUR', symbol: '€', decimal_digits: 2, rounding: 0 }

const participants = [
  { id: 'alice', name: 'Alice' },
  { id: 'bob', name: 'Bob' },
  { id: 'carol', name: 'Carol' },
]

const balances = {
  alice: { paid: 3000, paidFor: 0, total: 3000 },
  bob: { paid: 0, paidFor: 2000, total: -2000 },
  carol: { paid: 0, paidFor: 1000, total: -1000 },
}

const reimbursements = [
  { from: 'bob', to: 'alice', amount: 2000 },
  { from: 'carol', to: 'alice', amount: 1000 },
]

describe('BalancesCard', () => {
  it('renders receive and pay sections from suggested reimbursement legs', () => {
    render(
      <BalancesCard
        isLoading={false}
        currencyDisplay="group"
        balances={balances}
        reimbursements={reimbursements}
        currencyBalances={[]}
        participants={participants}
        groupCurrency={EUR}
        groupId="group-1"
      />,
    )

    expect(screen.getByText('To receive')).toBeInTheDocument()
    expect(screen.getByText('To pay')).toBeInTheDocument()
    expect(
      screen.getByText('Each segment shows who is paying you.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Each segment shows who you need to pay.'),
    ).toBeInTheDocument()
    expect(screen.getAllByText('Alice').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Bob').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Carol').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('participant-segment-bar')).toHaveLength(3)
    expect(
      screen
        .getAllByTestId('participant-segment-bar')
        .every((bar) => bar.querySelector('[aria-hidden="true"].h-4')),
    ).toBe(true)
    expect(screen.queryByText(/owes/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /Mark as paid/ })).toHaveLength(
      2,
    )
  })

  it('keeps original currency on payer actions in expense-currency mode', () => {
    render(
      <BalancesCard
        isLoading={false}
        currencyDisplay="original"
        balances={undefined}
        reimbursements={undefined}
        currencyBalances={[
          {
            currencyCode: 'EUR',
            currency: EUR,
            balances,
            reimbursements,
          },
        ]}
        participants={participants}
        groupCurrency={EUR}
        groupId="group-1"
      />,
    )

    expect(screen.getByText('EUR')).toBeInTheDocument()
    expect(
      document.querySelector('img[src*="flagcdn.com/h24/eu.png"]'),
    ).toBeInTheDocument()
    const markAsPaid = screen.getAllByText('Mark as paid')[0].closest('a')
    expect(markAsPaid).toHaveAttribute('href')
    expect(markAsPaid?.getAttribute('href')).toContain('originalCurrency=EUR')
  })
})
