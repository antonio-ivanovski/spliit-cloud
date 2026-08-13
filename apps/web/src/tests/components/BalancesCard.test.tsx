import { describe, expect, it, vi } from 'vitest'

import { BalancesCard } from '@/app/groups/[groupId]/balances/balances-card'
import {
  useCurrentGroup,
  useIsPendingInvitee,
} from '@/app/groups/[groupId]/current-group-context'
import { render, screen } from '@/test/test-utils'

vi.mock('@/app/groups/[groupId]/current-group-context', () => ({
  useCurrentGroup: vi.fn(),
  useCurrentGroupOrNull: vi.fn().mockReturnValue(null),
  useIsPendingInvitee: vi.fn(),
}))

vi.mock('@/app/groups/[groupId]/use-link-invite-token', () => ({
  useLinkInviteToken: vi.fn(() => undefined),
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
  vi.mocked(useIsPendingInvitee).mockReturnValue(false)
}

describe('BalancesCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupCurrentGroup()
  })

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
      screen.queryByText('Each segment shows who is paying you.'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText('Each segment shows who pays this participant.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Each segment shows who this participant pays.'),
    ).toBeInTheDocument()
    const emphasizedNames = Array.from(
      screen
        .getByTestId('settlement-balances')
        .querySelectorAll('strong.font-semibold'),
    )
    expect(
      emphasizedNames.some(
        (element) => element.parentElement?.textContent === 'Alice receives',
      ),
    ).toBe(true)
    expect(
      emphasizedNames.some(
        (element) => element.parentElement?.textContent === 'Bob pays',
      ),
    ).toBe(true)
    expect(
      emphasizedNames.some(
        (element) => element.parentElement?.textContent === 'Carol pays',
      ),
    ).toBe(true)
    expect(
      emphasizedNames.filter((element) => element.textContent === 'Alice'),
    ).toHaveLength(3)
    expect(screen.getAllByTestId('participant-segment-bar')).toHaveLength(3)
    expect(
      screen
        .getAllByTestId('participant-segment-bar')
        .every((bar) => bar.querySelector('[aria-hidden="true"].h-4')),
    ).toBe(true)
    expect(screen.queryByText(/owes/)).not.toBeInTheDocument()
    expect(screen.getAllByTestId(/reimbursement-settle-/)).toHaveLength(4)
    expect(
      screen.getByTestId('reimbursement-settle-pay-bob-alice'),
    ).toHaveTextContent('Settle')
    expect(
      screen.getByTestId('reimbursement-settle-receive-bob-alice'),
    ).toBeInTheDocument()
  })

  it('opens the create reimbursement modal when clicking a per-leg settle action', async () => {
    const { user } = render(
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

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('reimbursement-settle-pay-bob-alice'))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Settlement payment')).toBeInTheDocument()
  })

  it('preserves the original currency on payer actions in expense-currency mode', () => {
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
    expect(
      screen.getAllByTestId(/reimbursement-settle-/).length,
    ).toBeGreaterThan(0)
  })

  it('renders virtual subgroup units and segment bars in visual subgroup mode', async () => {
    const { user } = render(
      <BalancesCard
        isLoading={false}
        currencyDisplay="group"
        settlementMode="subgroups"
        balances={{
          alice: { paid: 1000, paidFor: 0, total: 1000 },
          bob: { paid: 0, paidFor: 500, total: -500 },
          carol: { paid: 1000, paidFor: 0, total: 1000 },
          dave: { paid: 0, paidFor: 1500, total: -1500 },
        }}
        reimbursements={[]}
        currencyBalances={[]}
        participants={[
          { id: 'alice', name: 'Alice' },
          { id: 'bob', name: 'Bob' },
          { id: 'carol', name: 'Carol' },
          { id: 'dave', name: 'Dave' },
        ]}
        groupCurrency={EUR}
        groupId="group-1"
        subgroups={[
          { id: 'couple-a', name: 'Couple A', memberIds: ['alice', 'bob'] },
          { id: 'couple-b', name: 'Couple B', memberIds: ['carol', 'dave'] },
        ]}
        subgroupSettlementPlan={{
          units: [
            {
              kind: 'subgroup',
              id: 'couple-a',
              name: 'Couple A',
              memberIds: ['alice', 'bob'],
              total: 500,
            },
            {
              kind: 'subgroup',
              id: 'couple-b',
              name: 'Couple B',
              memberIds: ['carol', 'dave'],
              total: -500,
            },
          ],
          legs: [
            {
              from: { kind: 'subgroup', id: 'couple-b' },
              to: { kind: 'subgroup', id: 'couple-a' },
              fromMemberIds: ['carol', 'dave'],
              toMemberIds: ['alice', 'bob'],
              amount: 500,
              payerId: 'dave',
              receiverId: 'alice',
            },
          ],
          hasInternalBalances: true,
        }}
      />,
    )

    expect(screen.getByTestId('visual-subgroup-settlement')).toBeInTheDocument()
    expect(screen.getAllByText('Couple A').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Couple B').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('participant-segment-bar').length).toBe(2)
    expect(screen.getAllByText('Dave').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Alice').length).toBeGreaterThan(0)
    await user.click(screen.getAllByText('Settle')[0])
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('exposes the shared settlement picker in visual individual mode', () => {
    render(
      <BalancesCard
        isLoading={false}
        currencyDisplay="group"
        settlementMode="individual"
        onSettlementModeChange={vi.fn()}
        balances={balances}
        reimbursements={reimbursements}
        currencyBalances={[]}
        participants={participants}
        groupCurrency={EUR}
        groupId="group-1"
        subgroups={[
          { id: 'couple', name: 'Couple', memberIds: ['alice', 'bob'] },
        ]}
        individualSettlementPolicy="all-individual"
      />,
    )

    expect(screen.getByText('Settle balances as')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Individual' })).toBeChecked()
    expect(
      screen.getByText(
        'You are viewing the standard group-wide individual plan. It may include payments between subgroups.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })
})
