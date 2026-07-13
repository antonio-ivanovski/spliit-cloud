import { SimpleBalancesCard } from '@/app/groups/[groupId]/balances/simple-balances-card'
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
]
const balances = {
  alice: { paid: 3000, paidFor: 0, total: 3000 },
  bob: { paid: 0, paidFor: 3000, total: -3000 },
}
const reimbursements = [{ from: 'bob', to: 'alice', amount: 3000 }]

describe('SimpleBalancesCard', () => {
  it('renders plain net balances and direct settlement actions without charts', () => {
    render(
      <SimpleBalancesCard
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

    expect(screen.getByText('Net balances')).toBeInTheDocument()
    expect(screen.getAllByText('Alice').length).toBeGreaterThan(0)
    expect(screen.getByText('is owed €30.00')).toBeInTheDocument()
    expect(screen.getByText('owes €30.00')).toBeInTheDocument()
    expect(screen.getByText('Suggested payments')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Mark €30\.00 from Bob to Alice/ }),
    ).toBeInTheDocument()
    expect(
      screen.queryByTestId('participant-segment-bar'),
    ).not.toBeInTheDocument()
  })

  it('preserves the native currency on original-currency settlement links', () => {
    render(
      <SimpleBalancesCard
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
      screen.getByRole('link', { name: /Mark €30\.00 from Bob to Alice/ }),
    ).toHaveAttribute('href', expect.stringContaining('originalCurrency=EUR'))
  })
})
