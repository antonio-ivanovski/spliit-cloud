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
    expect(
      screen.getAllByRole('button', { name: /Mark .* as paid/ }),
    ).toHaveLength(2)
    expect(
      screen.getByRole('button', {
        name: 'Mark €20.00 from Bob to Alice as paid',
      }),
    ).toBeInTheDocument()
  })

  it('opens the create reimbursement modal when clicking Mark as paid', async () => {
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
    await user.click(screen.getAllByText('Mark as paid')[0])

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
      screen.getAllByRole('button', { name: /Mark .* as paid/ }).length,
    ).toBeGreaterThan(0)
  })
})
