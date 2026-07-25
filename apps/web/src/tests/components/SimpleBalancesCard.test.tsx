import { SimpleBalancesCard } from '@/app/groups/[groupId]/balances/simple-balances-card'
import {
  useCurrentGroup,
  useIsPendingInvitee,
} from '@/app/groups/[groupId]/current-group-context'
import { render, screen } from '@/test/test-utils'
import { describe, expect, it, vi } from 'vitest'

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
]
const balances = {
  alice: { paid: 3000, paidFor: 0, total: 3000 },
  bob: { paid: 0, paidFor: 3000, total: -3000 },
}
const reimbursements = [{ from: 'bob', to: 'alice', amount: 3000 }]

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
    const emphasizedLabels = Array.from(
      document.querySelectorAll('strong.font-semibold'),
    )
    expect(
      emphasizedLabels.some(
        (element) => element.parentElement?.textContent === 'Alice receives',
      ),
    ).toBe(true)
    expect(
      emphasizedLabels.some(
        (element) => element.parentElement?.textContent === 'Bob pays',
      ),
    ).toBe(true)
    expect(screen.queryByText(/<strong>/)).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: /Mark €30\.00 from Bob to Alice/,
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByTestId('participant-segment-bar'),
    ).not.toBeInTheDocument()
  })

  it('preserves the native currency on original-currency settlement actions', () => {
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
      screen.getByRole('button', {
        name: /Mark €30\.00 from Bob to Alice/,
      }),
    ).toBeInTheDocument()
  })

  it('renders loading skeletons without crashing when participantCount is 0', () => {
    expect(() =>
      render(
        <SimpleBalancesCard
          isLoading={true}
          participantCount={0}
          currencyDisplay="group"
          balances={undefined}
          reimbursements={undefined}
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
})
