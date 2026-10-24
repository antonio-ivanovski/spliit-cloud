import { describe, expect, it, vi } from 'vitest'

import { SimpleBalancesCard } from '@/app/groups/[groupId]/balances/simple-balances-card'
import {
  useCurrentGroup,
  useIsReadOnlyGroupViewer,
} from '@/app/groups/[groupId]/current-group-context'
import { render, screen, within } from '@/test/test-utils'

vi.mock('@/app/groups/[groupId]/current-group-context', () => ({
  useCurrentGroup: vi.fn(),
  useCurrentGroupOrNull: vi.fn().mockReturnValue(null),
  useIsReadOnlyGroupViewer: vi.fn(),
}))

vi.mock('@/app/groups/[groupId]/expenses/expense-mutation-hooks', () => ({
  useCreateExpenseMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      groups: { balances: { invalidate: vi.fn() } },
    }),
  },
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useRouter: () => ({}),
  Link: ({
    to,
    search,
    children,
    ...props
  }: {
    to: string
    search?: unknown
    children?: React.ReactNode
    [key: string]: unknown
  }) => (
    <a href={to} data-search={JSON.stringify(search)} {...props}>
      {children}
    </a>
  ),
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
const suggestedSettlements = [{ from: 'bob', to: 'alice', amount: 3000 }]

function setupCurrentGroup() {
  vi.mocked(useCurrentGroup).mockReturnValue({
    isLoading: false,
    groupId: 'group-1',
    group: {
      id: 'group-1',
      currencyCode: 'EUR',
      ledger: { currencyCode: 'EUR' },
      participants: [],
      archived: false,
    } as never,
    displayName: 'Group',
    currentLedgerParticipantId: null,
    currentMember: null,
    currentInvitation: null,
    linkInviteState: null,
  })
  vi.mocked(useIsReadOnlyGroupViewer).mockReturnValue(false)
}

describe('SimpleBalancesCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupCurrentGroup()
  })

  it('renders plain net balances and direct settlement actions without charts', () => {
    render(
      <SimpleBalancesCard
        isLoading={false}
        currencyDisplay="group"
        balances={balances}
        suggestedSettlements={suggestedSettlements}
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
    const emphasizedLabels = Array.from(
      document.querySelectorAll('strong.font-semibold'),
    )
    expect(
      emphasizedLabels.some(
        (element) => element.parentElement?.textContent === 'Alice receives',
      ),
    ).toBe(false)
    expect(
      emphasizedLabels.some(
        (element) => element.parentElement?.textContent === 'Bob pays',
      ),
    ).toBe(true)
    expect(screen.queryByText(/<strong>/)).not.toBeInTheDocument()
    expect(
      screen.getByTestId('settlement-settle-pay-bob-alice'),
    ).toHaveTextContent('Settle')
    expect(
      screen.getByTestId('settlement-settle-pay-bob-alice'),
    ).toHaveAttribute('aria-label', 'Settle 1 payments by Bob, €30.00')
    expect(
      screen.queryByTestId('participant-segment-bar'),
    ).not.toBeInTheDocument()
  })

  it('splits payments from the balance overview and keeps visual detail local', () => {
    render(
      <SimpleBalancesCard
        isLoading={false}
        currencyDisplay="group"
        balances={balances}
        suggestedSettlements={suggestedSettlements}
        currencyBalances={[]}
        participants={participants}
        groupCurrency={EUR}
        groupId="group-1"
        view="visual"
      />,
    )

    expect(
      screen.getByRole('heading', { name: 'Suggested payments' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Balances' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('settlement-balances')).toBeInTheDocument()
    expect(screen.getAllByTestId('participant-segment-bar')).toHaveLength(2)
  })

  it('can switch compact payments to receiver groups without duplicating legs', async () => {
    const { user } = render(
      <SimpleBalancesCard
        isLoading={false}
        currencyDisplay="group"
        balances={balances}
        suggestedSettlements={suggestedSettlements}
        currencyBalances={[]}
        participants={participants}
        groupCurrency={EUR}
        groupId="group-1"
      />,
    )

    expect(screen.getByRole('radio', { name: 'To pay' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'To receive' })).not.toBeChecked()

    await user.click(screen.getByRole('radio', { name: 'To receive' }))

    expect(screen.getByRole('radio', { name: 'To receive' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'To pay' })).not.toBeChecked()
    expect(
      screen.getByTestId('settlement-settle-receive-bob-alice'),
    ).toHaveTextContent('Settle')
    expect(
      screen.getByTestId('settlement-settle-receive-bob-alice'),
    ).toHaveAttribute('aria-label', 'Settle 1 payments to Alice, €30.00')
  })

  it('preserves the native currency on original-currency settlement actions', () => {
    render(
      <SimpleBalancesCard
        isLoading={false}
        currencyDisplay="original"
        balances={undefined}
        suggestedSettlements={undefined}
        currencyBalances={[
          {
            currencyCode: 'EUR',
            currency: EUR,
            balances,
            suggestedSettlements,
          },
        ]}
        participants={participants}
        groupCurrency={EUR}
        groupId="group-1"
      />,
    )

    expect(screen.getAllByText('EUR')).toHaveLength(2)
    expect(screen.getAllByTestId(/settlement-settle-/).length).toBeGreaterThan(
      0,
    )
  })

  it('renders loading skeletons without crashing when participantCount is 0', () => {
    expect(() =>
      render(
        <SimpleBalancesCard
          isLoading={true}
          participantCount={0}
          currencyDisplay="group"
          balances={undefined}
          suggestedSettlements={undefined}
          currencyBalances={[]}
          participants={[]}
          groupCurrency={undefined}
          groupId="group-1"
        />,
      ),
    ).not.toThrow()

    const skeletons = document.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('uses the resolved participant name for an ungrouped pending invite', () => {
    const pendingId = 'lp-pending-invite'
    render(
      <SimpleBalancesCard
        isLoading={false}
        currencyDisplay="group"
        settlementMode="subgroups"
        balances={{
          alice: { paid: 1000, paidFor: 0, total: 1000 },
          bob: { paid: 0, paidFor: 1000, total: -1000 },
          [pendingId]: { paid: 500, paidFor: 0, total: 500 },
        }}
        suggestedSettlements={[]}
        currencyBalances={[]}
        participants={[
          { id: 'alice', name: 'Alice' },
          { id: 'bob', name: 'Bob' },
          { id: pendingId, name: 'Alex from the trip' },
        ]}
        groupCurrency={EUR}
        groupId="group-1"
        subgroups={[
          { id: 'couple', name: 'Couple', memberIds: ['alice', 'bob'] },
        ]}
        subgroupSettlementPlan={{
          units: [
            {
              kind: 'subgroup',
              id: 'couple',
              name: 'Couple',
              memberIds: ['alice', 'bob'],
              total: 0,
            },
            {
              kind: 'participant',
              id: pendingId,
              name: pendingId,
              memberIds: [pendingId],
              total: 500,
            },
          ],
          legs: [],
          hasInternalBalances: true,
        }}
      />,
    )

    expect(screen.getAllByText('Alex from the trip').length).toBeGreaterThan(0)
    expect(screen.queryByText(pendingId)).not.toBeInTheDocument()
  })

  it('uses the group-wide individual plan when subgroups exist', () => {
    render(
      <SimpleBalancesCard
        isLoading={false}
        currencyDisplay="group"
        balances={balances}
        suggestedSettlements={suggestedSettlements}
        currencyBalances={[]}
        participants={participants}
        groupCurrency={EUR}
        groupId="group-1"
        individualSettlementPolicy="all-individual"
        subgroups={[
          { id: 'couple', name: 'Couple', memberIds: ['alice', 'bob'] },
        ]}
      />,
    )

    expect(
      screen.getByText(
        'You are viewing the standard group-wide individual plan. It may include payments between subgroups.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })
  describe('direct (un-simplified) payments', () => {
    const chainParticipants = [
      { id: 'alice', name: 'Alice' },
      { id: 'bob', name: 'Bob' },
      { id: 'carol', name: 'Carol' },
    ]
    // Alice paid for Bob, Bob paid for Carol: Bob nets to zero but still has
    // a direct debt to Alice and is owed by Carol.
    const chainBalances = {
      alice: { paid: 1000, paidFor: 0, total: 1000 },
      bob: { paid: 1000, paidFor: 1000, total: 0 },
      carol: { paid: 0, paidFor: 1000, total: -1000 },
    }
    const directLegs = [
      { from: 'bob', to: 'alice', amount: 1000 },
      { from: 'carol', to: 'bob', amount: 1000 },
    ]

    it('renders the Simplified / Direct picker and reports changes', async () => {
      const onSettlementViewChange = vi.fn()
      const { user } = render(
        <SimpleBalancesCard
          isLoading={false}
          currencyDisplay="group"
          balances={balances}
          suggestedSettlements={suggestedSettlements}
          currencyBalances={[]}
          participants={participants}
          groupCurrency={EUR}
          groupId="group-1"
          settlementView="simplified"
          onSettlementViewChange={onSettlementViewChange}
        />,
      )

      expect(screen.getByRole('radio', { name: 'Simplified' })).toBeChecked()
      expect(screen.getByRole('radio', { name: 'Direct' })).not.toBeChecked()

      await user.click(screen.getByRole('radio', { name: 'Direct' }))

      expect(onSettlementViewChange).toHaveBeenCalledWith('direct')
    })

    it('shows pairwise legs with settle actions, including net-zero members', () => {
      render(
        <SimpleBalancesCard
          isLoading={false}
          currencyDisplay="group"
          balances={chainBalances}
          suggestedSettlements={directLegs}
          currencyBalances={[]}
          participants={chainParticipants}
          groupCurrency={EUR}
          groupId="group-1"
          settlementView="direct"
          onSettlementViewChange={vi.fn()}
        />,
      )

      expect(screen.getByRole('radio', { name: 'Direct' })).toBeChecked()
      expect(
        screen.getByText(
          'What each person owes the people they actually shared expenses with, without combining debts across the group.',
        ),
      ).toBeInTheDocument()
      expect(
        screen.getByTestId('settlement-settle-pay-bob-alice'),
      ).toHaveTextContent('Settle')
      expect(
        screen.getByTestId('settlement-settle-pay-carol-bob'),
      ).toHaveTextContent('Settle')
      expect(
        screen.queryByTestId('settlement-settle-pay-carol-alice'),
      ).not.toBeInTheDocument()
    })

    it('lists net-zero members on both sides of the visual view', () => {
      render(
        <SimpleBalancesCard
          isLoading={false}
          currencyDisplay="group"
          balances={chainBalances}
          suggestedSettlements={directLegs}
          currencyBalances={[]}
          participants={chainParticipants}
          groupCurrency={EUR}
          groupId="group-1"
          view="visual"
          settlementView="direct"
          onSettlementViewChange={vi.fn()}
        />,
      )

      const section = screen.getByTestId('settlement-balances')
      const toReceive = within(section).getByRole('region', {
        name: 'To receive',
      })
      const toPay = within(section).getByRole('region', { name: 'To pay' })
      expect(within(toReceive).getAllByText(/Bob/).length).toBeGreaterThan(0)
      expect(within(toPay).getAllByText(/Bob/).length).toBeGreaterThan(0)
      expect(
        within(section).queryByRole('region', { name: 'Settled up' }),
      ).not.toBeInTheDocument()
    })

    it('shows a note when direct debts are unavailable offline', () => {
      render(
        <SimpleBalancesCard
          isLoading={false}
          currencyDisplay="group"
          balances={balances}
          suggestedSettlements={suggestedSettlements}
          currencyBalances={[]}
          participants={participants}
          groupCurrency={EUR}
          groupId="group-1"
          settlementView="direct"
          onSettlementViewChange={vi.fn()}
          settlementViewNote="Direct debts need a connection. Showing simplified payments while offline."
        />,
      )

      expect(
        screen.getByText(
          'Direct debts need a connection. Showing simplified payments while offline.',
        ),
      ).toBeInTheDocument()
    })
  })
})
