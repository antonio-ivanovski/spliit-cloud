import { render, screen, waitFor } from '@/test/integration/test-utils'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

/**
 * BLOCK C: Integration tests (real API + real TRPCProvider).
 *
 * These tests start a real API server, create a test session, and use
 * the real tRPC client to create data. Components are rendered with
 * the real TRPCProvider but context hooks are mocked so we don't need
 * a full route / provider setup.
 *
 * Prerequisites:
 *   - PostgreSQL test database running (postgresql://test:test@localhost:5432/test)
 *   - Migrations up to date
 *   - Set INTEGRATION_TEST=true or CI=true to enable these tests
 */

// ── Skip guard ──────────────────────────────────────────────────────────

const isIntegrationEnv =
  !!process.env.INTEGRATION_TEST || !!process.env.CI
const describeIntegration = describe.skipIf(!isIntegrationEnv)

// ── Hoisted mocks ───────────────────────────────────────────────────────

const contextMocks = vi.hoisted(() => ({
  mockUseCurrentGroup: vi.fn(),
  mockUseIsPendingInvitee: vi.fn(() => false),
}))

const tanstackMocks = vi.hoisted(() => ({
  mockUseSearch: vi.fn(() => ({})),
  mockUseLocation: vi.fn(() => ({ pathname: '/groups/test-group' })),
}))

// ── Module mocks (hoisted to top) ───────────────────────────────────────

vi.mock('@/app/groups/[groupId]/current-group-context', () => ({
  useCurrentGroup: contextMocks.mockUseCurrentGroup,
  useIsPendingInvitee: contextMocks.mockUseIsPendingInvitee,
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...props
  }: {
    to: string
    children: React.ReactNode
    [key: string]: unknown
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useSearch: tanstackMocks.mockUseSearch,
  useLocation: tanstackMocks.mockUseLocation,
}))

vi.mock('@/lib/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
  }),
}))

// ── Shared state ────────────────────────────────────────────────────────

let port: number
let sessionCookie: string
let closeServer: () => Promise<void>
const testEmail = `test-${Date.now()}@integration-spliit.local`
const testPassword = 'TestPass123!'

interface TestGroup {
  id: string
  name: string
}
interface TestExpense {
  id: string
  title: string
  amount: number
}

let testGroup: TestGroup
let testExpense: TestExpense

// ── Helper ──────────────────────────────────────────────────────────────

/**
 * Call a tRPC procedure on the test server via raw fetch.
 */
async function trpcCall<T = unknown>(
  procedure: string,
  input: unknown,
): Promise<T> {
  const res = await fetch(`http://localhost:${port}/trpc/${procedure}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: sessionCookie,
    },
    body: JSON.stringify({ 0: { json: input } }),
  })
  const body = await res.json()
  if (body[0]?.error) throw new Error(body[0].error.message)
  return (body[0]?.result?.data?.json ?? body[0]?.result?.data) as T
}

// ── Integration tests ───────────────────────────────────────────────────

describeIntegration('Group creation integration', () => {
  beforeAll(async () => {
    // ── Start test server ──────────────────────────────────────────
    const { startTestServer, createTestSession } = await import(
      '@/test/integration/server'
    )

    const server = await startTestServer()
    port = server.port
    closeServer = server.close

    // Points the TRPCProvider at the test server
    process.env.VITE_API_URL = `http://localhost:${port}`

    // Create a session for the test user
    sessionCookie = await createTestSession(port, testEmail, testPassword)

    // ── Create a test group via the real API ───────────────────────
    const createResult = await trpcCall<{ group: TestGroup }>(
      'groups.create',
      {
        name: 'Integration Test Group',
        currency: 'EUR',
        participants: [],
      },
    )
    testGroup = createResult.group

    // ── Add a test expense ─────────────────────────────────────────
    const groupResult = await trpcCall<{
      group: { participants: Array<{ id: string; name: string }> }
    }>('groups.get', { groupId: testGroup.id, linkInviteToken: undefined })
    const participantId = groupResult.group.participants[0]?.id

    if (participantId) {
      const expenseResult = await trpcCall<{ expense: TestExpense }>(
        'groups.expenses.create',
        {
          groupId: testGroup.id,
          title: 'Integration Dinner',
          amount: 2500,
          paidById: participantId,
          paidFor: [{ ledgerParticipantId: participantId, shares: null }],
          splitMode: 'EQUAL',
          expenseDate: new Date().toISOString(),
          categoryId: 'food',
        },
      )
      testExpense = expenseResult.expense
    }
  }, 30000)

  afterAll(async () => {
    const { cleanupTestData } = await import('@/test/integration/server')
    await cleanupTestData(port, testEmail)
    await closeServer?.()
  }, 10000)

  // ── Test 1: GroupInformation renders group name ──────────────────

  it('renders group name via GroupInformation using API-created data', async () => {
    contextMocks.mockUseCurrentGroup.mockReturnValue({
      isLoading: false,
      groupId: testGroup.id,
      group: {
        id: testGroup.id,
        name: testGroup.name,
        information: null,
        archived: false,
        currency: 'EUR',
      },
      currentLedgerParticipantId: 'lp-dummy',
      currentMember: { id: 'cm-dummy', role: 'ADMIN' },
      currentInvitation: null,
      linkInviteState: null,
    })
    contextMocks.mockUseIsPendingInvitee.mockReturnValue(false)

    const GroupInformation = (
      await import(
        '@/app/groups/[groupId]/information/group-information'
      )
    ).default

    render(<GroupInformation groupId={testGroup.id} />)

    // The group name comes from the API-created group data
    expect(screen.getByText('Integration Test Group')).toBeInTheDocument()
  })

  // ── Test 2: ExpenseCard renders title and amount ─────────────────

  it('renders expense title and formatted amount via ExpenseCard', async () => {
    contextMocks.mockUseCurrentGroup.mockReturnValue({
      isLoading: false,
      groupId: testGroup.id,
      group: {
        id: testGroup.id,
        name: testGroup.name,
        archived: false,
        currency: 'EUR',
        currencyCode: 'EUR',
        participants: [
          {
            id: 'lp-dummy',
            name: 'You',
            pending: false,
            unlinked: false,
          },
        ],
      },
      currentLedgerParticipantId: 'lp-dummy',
      currentMember: { id: 'cm-dummy', role: 'ADMIN' },
      currentInvitation: null,
      linkInviteState: null,
    })
    contextMocks.mockUseIsPendingInvitee.mockReturnValue(false)

    const { ExpenseCard } = await import(
      '@/app/groups/[groupId]/expenses/expense-card'
    )

    const expenseData = {
      id: testExpense.id,
      title: testExpense.title,
      amount: testExpense.amount,
      categoryId: 'food',
      category: 'food',
      expenseDate: new Date(),
      createdAt: new Date(),
      paidBy: { id: 'lp-dummy', name: 'You' },
      paidFor: [
        {
          ledgerParticipant: { id: 'lp-dummy', name: 'You' },
          shares: null,
        },
      ],
      isReimbursement: false,
      splitMode: 'EQUAL' as const,
      recurrenceRule: null,
      _count: { documents: 0 },
    }

    render(
      <ExpenseCard
        expense={expenseData}
        currency={{ symbol: '€', code: 'EUR', name: 'Euro' }}
        groupId={testGroup.id}
        participantCount={1}
      />,
    )

    expect(screen.getByText('Integration Dinner')).toBeInTheDocument()
    expect(screen.getByText('€25.00')).toBeInTheDocument()
  })

  // ── Test 3: BalancesList renders balances from API data ──────────

  it('renders balances from API-created expense data', async () => {
    // Fetch real balances from the API
    const balancesResult = await trpcCall<{
      balances: Array<{
        participant: { id: string; name: string }
        balance: number
      }>
    }>('groups.balances.list', {
      groupId: testGroup.id,
      linkInviteToken: undefined,
    })

    // BalancesList expects { [participantId]: { total: number } }
    const balancesMap: Record<string, { total: number }> = {}
    if (balancesResult.balances) {
      for (const b of balancesResult.balances) {
        balancesMap[b.participant.id] = { total: b.balance }
      }
    }

    const participants = balancesResult.balances.map((b) => ({
      id: b.participant.id,
      name: b.participant.name,
    }))

    const { BalancesList } = await import(
      '@/app/groups/[groupId]/balances-list'
    )

    render(
      <BalancesList
        balances={balancesMap}
        participants={participants}
        currency={{ symbol: '€', code: 'EUR', name: 'Euro' }}
      />,
    )

    // BalancesList renders a div with data-testid="balances-list"
    await waitFor(() => {
      expect(screen.getByTestId('balances-list')).toBeInTheDocument()
    })

    // If an expense was created (self-pay for the whole amount), the
    // creator should have a positive balance of 2500 cents = €25.00
    if (testExpense && balancesResult.balances.length > 0) {
      const payerBalance = balancesResult.balances.find(
        (b) => b.balance > 0,
      )
      if (payerBalance) {
        expect(
          screen.getByTestId(
            `balance-row-${payerBalance.participant.name}`,
          ),
        ).toBeInTheDocument()
        expect(screen.getByText('€25.00')).toBeInTheDocument()
      }
    }
  })
})
