import {
  cleanupTestAccount,
  createTestSession,
  probeExistingApi,
} from '@/test/integration/client'
import { render, screen, waitFor } from '@/test/integration/test-utils'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * Integration tests: real API + real TRPCProvider.
 *
 * These tests connect to an already-running API server on port 3001
 * (or VITE_API_URL), create a test session, and use the real tRPC
 * endpoints to create data. Components are rendered with the real
 * TRPCProvider but context hooks are mocked so we don't need a full
 * route / provider setup.
 *
 * If the API is not running the entire suite is skipped.
 *
 * Prerequisites:
 *   - API server running (e.g. `bun dev` from project root)
 *   - PostgreSQL test database up to date
 */

// ── Skip guard (evaluated once at module load) ───────────────────────────

const apiReachable = await probeExistingApi()
const describeIntegration = apiReachable
  ? describe
  : describe.skip('API server not running — start with `bun dev` first')

// ── Hoisted mocks ────────────────────────────────────────────────────────

const contextMocks = vi.hoisted(() => ({
  mockUseCurrentGroup: vi.fn(),
  mockUseIsPendingInvitee: vi.fn(() => false),
}))

const tanstackMocks = vi.hoisted(() => ({
  mockUseSearch: vi.fn(() => ({})),
  mockUseLocation: vi.fn(() => ({ pathname: '/groups/test-group' })),
}))

// ── Module mocks (hoisted to top) ────────────────────────────────────────

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

// ── Shared state ─────────────────────────────────────────────────────────

const API_URL = 'http://localhost:3001'

let sessionCookie: string
const testEmail = `test-${Date.now()}@integration-spliit.local`
const testPassword = 'TestPass123!'

interface TestGroup {
  id: string
  name: string
  currency: string
  currencyCode: string
  ledger: {
    id: string
    currency: string
    currencyCode: string
    groupId: string
  }
  participants: Array<{ id: string; name: string }>
}

let testGroup: TestGroup
let testExpenseId: string

// ── Helper ───────────────────────────────────────────────────────────────

/**
 * tRPC procedure types — used to pick the HTTP method.
 * Queries use GET, mutations use POST.
 */
const queryProcedures = new Set([
  'groups.get',
  'groups.list',
  'groups.balances.list',
  'groups.expenses.list',
])

/**
 * Call a tRPC procedure on the existing API server via raw fetch.
 *
 * Wire format (superjson-wrapped):
 *   POST (mutation):  body: { json: input }
 *   GET  (query):     ?input={ json: input }
 *   Response:         { result: { data: { json: output } } }
 */
async function trpcCall<T = unknown>(
  procedure: string,
  input: unknown,
): Promise<T> {
  const isQuery = queryProcedures.has(procedure)

  let res: Response
  if (isQuery) {
    const inputParam = encodeURIComponent(JSON.stringify({ json: input }))
    res = await fetch(`${API_URL}/trpc/${procedure}?input=${inputParam}`, {
      method: 'GET',
      headers: { Cookie: sessionCookie },
    })
  } else {
    res = await fetch(`${API_URL}/trpc/${procedure}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({ json: input }),
    })
  }

  const body = await res.json()
  // tRPC error envelope: { error: { json: { message, ... } } }
  if (body.error) {
    const errMsg =
      body.error?.json?.message ?? body.error.message ?? 'Unknown tRPC error'
    throw new Error(errMsg)
  }
  // Unwrap tRPC success envelope: { result: { data: { json: output } } }
  return body?.result?.data?.json as T
}

// ── Integration tests ────────────────────────────────────────────────────

describeIntegration('Group CRUD via existing API', () => {
  beforeAll(async () => {
    // Create a session for the test user
    sessionCookie = await createTestSession(API_URL, testEmail, testPassword)

    // ── Create a test group via the real API ───────────────────────
    const createResult = await trpcCall<{ groupId: string }>('groups.create', {
      groupFormValues: {
        name: 'Integration Test Group',
        currency: 'EUR',
        participants: [{ name: 'Me' }],
      },
    })

    // Fetch the group to get full details (participants, ledger, etc.)
    const groupResult = await trpcCall<{
      group: TestGroup
      currentLedgerParticipantId: string | null
    }>('groups.get', {
      groupId: createResult.groupId,
      linkInviteToken: undefined,
    })
    testGroup = groupResult.group

    // ── Add a test expense (self-pay) ──────────────────────────────
    const participantId = testGroup.participants[0]?.id
    if (participantId) {
      const expenseResult = await trpcCall<{ expenseId: string }>(
        'groups.expenses.create',
        {
          groupId: testGroup.id,
          expenseFormValues: {
            title: 'Integration Dinner',
            amount: 2500,
            paidBy: participantId,
            paidFor: [{ participant: participantId, shares: 1 }],
            splitMode: 'EVENLY',
            expenseDate: new Date().toISOString(),
            category: 'dining-out',
            isReimbursement: false,
            saveDefaultSplittingOptions: false,
            recurrenceRule: 'NONE',
          },
        },
      )
      testExpenseId = expenseResult.expenseId
    }
  }, 30000)

  afterAll(async () => {
    await cleanupTestAccount(testEmail)
  }, 10000)

  // ── Test 1: GroupInformation renders with context ────────────────

  it('renders GroupInformation with the mocked group context', async () => {
    contextMocks.mockUseCurrentGroup.mockReturnValue({
      isLoading: false,
      groupId: testGroup.id,
      group: {
        id: testGroup.id,
        name: testGroup.name,
        information: null,
        archived: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        ledgerId: testGroup.ledger?.id ?? 'ledger-dummy',
        currency: testGroup.currency,
        currencyCode: testGroup.currencyCode,
        ledger: testGroup.ledger ?? {
          id: 'ledger-dummy',
          currency: 'EUR',
          currencyCode: 'EUR',
          groupId: testGroup.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        participants: [],
        members: [],
        invitations: [],
      },
      currentLedgerParticipantId: 'lp-dummy',
      currentMember: { id: 'cm-dummy', role: 'ADMIN', status: 'ACTIVE' },
      currentInvitation: null,
      linkInviteState: null,
    })
    contextMocks.mockUseIsPendingInvitee.mockReturnValue(false)

    const GroupInformation = (
      await import('@/app/groups/[groupId]/information/group-information')
    ).default

    render(<GroupInformation groupId={testGroup.id} />)

    // The component renders a heading "Information" (i18n key).
    expect(
      screen.getByRole('heading', { name: /information/i }),
    ).toBeInTheDocument()
    // Edit button links to the group edit page.
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      `/groups/${testGroup.id}/edit`,
    )
  })

  // ── Test 2: ExpenseCard renders title and amount ─────────────────

  it('renders expense title and formatted amount via ExpenseCard', async () => {
    const participantId = testGroup.participants[0]?.id
    const participantName = testGroup.participants[0]?.name ?? 'You'

    contextMocks.mockUseCurrentGroup.mockReturnValue({
      isLoading: false,
      groupId: testGroup.id,
      group: {
        id: testGroup.id,
        name: testGroup.name,
        archived: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        ledgerId: testGroup.ledger?.id ?? 'ledger-dummy',
        information: null,
        currency: testGroup.currency,
        currencyCode: testGroup.currencyCode,
        ledger: testGroup.ledger ?? {
          id: 'ledger-dummy',
          currency: 'EUR',
          currencyCode: 'EUR',
          groupId: testGroup.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        participants: [
          {
            id: participantId ?? 'lp-dummy',
            name: participantName,
            pending: false,
            unlinked: false,
          },
        ],
        members: [],
        invitations: [],
      },
      currentLedgerParticipantId: participantId ?? 'lp-dummy',
      currentMember: { id: 'cm-dummy', role: 'ADMIN', status: 'ACTIVE' },
      currentInvitation: null,
      linkInviteState: null,
    })
    contextMocks.mockUseIsPendingInvitee.mockReturnValue(false)

    const { ExpenseCard } =
      await import('@/app/groups/[groupId]/expenses/expense-card')

    const expenseData = {
      id: testExpenseId,
      title: 'Integration Dinner',
      amount: 2500,
      categoryId: 'dining-out',
      category: {
        id: 'dining-out',
        grouping: 'Food & Drink',
        name: 'Dining Out',
      },
      expenseDate: new Date(),
      createdAt: new Date(),
      paidBy: { id: participantId ?? 'lp-dummy', name: participantName },
      paidFor: [
        {
          ledgerParticipant: {
            id: participantId ?? 'lp-dummy',
            name: participantName,
          },
          shares: 1,
        },
      ],
      isReimbursement: false,
      splitMode: 'EVENLY' as const,
      recurrenceRule: 'NONE' as const,
      _count: { documents: 0 },
    }

    render(
      <ExpenseCard
        expense={expenseData as any}
        currency={{ symbol: '€', code: 'EUR', rounding: 0, decimal_digits: 2 }}
        groupId={testGroup.id}
        participantCount={1}
      />,
    )

    expect(screen.getByText('Integration Dinner')).toBeInTheDocument()
    // Use getAllByText for the amount (it appears in the amount badge
    // and may also appear in the balance breakdown)
    expect(screen.getAllByText('€25.00').length).toBeGreaterThan(0)
  })

  // ── Test 3: BalancesList renders from API data ───────────────────

  it('renders BalancesList with participants from the API', async () => {
    // Fetch real balances from the API.
    // The API returns { balances: { [participantId]: { paid, paidFor, total } } }
    const balancesResult = await trpcCall<{
      balances: Record<string, { paid: number; paidFor: number; total: number }>
      reimbursements: Array<unknown>
    }>('groups.balances.list', {
      groupId: testGroup.id,
      linkInviteToken: undefined,
    })

    // BalancesList expects { [participantId]: { paid, paidFor, total } }
    const balancesMap = balancesResult.balances ?? {}

    const { BalancesList } =
      await import('@/app/groups/[groupId]/balances-list')

    render(
      <BalancesList
        balances={balancesMap}
        participants={testGroup.participants.map((p) => ({
          id: p.id,
          name: p.name,
        }))}
        currency={{ symbol: '€', code: 'EUR', rounding: 0, decimal_digits: 2 }}
      />,
    )

    // BalancesList renders a div with data-testid="balances-list"
    await waitFor(() => {
      expect(screen.getByTestId('balances-list')).toBeInTheDocument()
    })

    // Since the expense is self-pay, the balance is zero for everyone.
    // The list renders a "Settled" / "All settled up" message.
    if (Object.keys(balancesMap).length === 0) {
      // When all balances are zero, the component may show a settled message
      // or an empty list. Just verify the container is present.
      expect(screen.getByTestId('balances-list')).toBeInTheDocument()
    } else {
      for (const p of testGroup.participants) {
        expect(screen.getByTestId(`balance-row-${p.name}`)).toBeInTheDocument()
      }
    }
  })
})
