import {
  cleanupTestAccount,
  createTestSession,
  probeExistingApi,
} from '@/test/integration/client'
import { render, screen, within } from '@/test/integration/test-utils'
import { prisma } from '@spliit/db'
import { randomId } from '@spliit/domain'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * Integration tests for expense items.
 *
 * These tests use the same pattern as `group-creation.test.tsx`:
 * - Connect to a real API server on port 3001 (via `probeExistingApi`).
 * - Create a real group + expense via tRPC.
 * - Render React components (here `ExpenseCard`) with mocked context
 *   hooks, so we don't need a full router setup.
 *
 * The suite is skipped if the API is not running. Items are exercised
 * end-to-end through the API and the `ItemsPreview` part of the card.
 */

// ── Skip guard (evaluated once at module load) ───────────────────────────

if (!(await probeExistingApi())) {
  throw new Error(
    `API server not running on http://localhost:3001. ` +
      `Start it with \`bun dev\` first.`,
  )
}

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
const testEmail = `test-items-${Date.now()}@integration-spliit.local`
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
let aliceParticipantId: string
let bobParticipantId: string

// ── tRPC helper ──────────────────────────────────────────────────────────

const queryProcedures = new Set([
  'groups.get',
  'groups.list',
  'groups.balances.list',
  'groups.expenses.list',
  'groups.expenses.get',
])

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
  if (body.error) {
    throw new Error(
      body.error?.json?.message ?? body.error.message ?? 'Unknown tRPC error',
    )
  }
  return body?.result?.data?.json as T
}

// ── Helpers ──────────────────────────────────────────────────────────────

function setupGroupContext() {
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
      participants: testGroup.participants.map((p) => ({
        id: p.id,
        name: p.name,
        pending: false,
        unlinked: false,
      })),
      members: [],
      invitations: [],
    },
    currentLedgerParticipantId: testGroup.participants[0]?.id ?? 'lp-dummy',
    currentMember: { id: 'cm-dummy', role: 'ADMIN', status: 'ACTIVE' },
    currentInvitation: null,
    linkInviteState: null,
  })
  contextMocks.mockUseIsPendingInvitee.mockReturnValue(false)
}

/** Build an expense payload with the given item array, paid by Admin. */
function buildExpensePayload(args: {
  amount: number
  splitMode: 'EVENLY' | 'ITEMIZED'
  items: Array<{
    title: string
    unitPrice: number
    quantity: number
    amount: number
    splitMode: 'EVENLY' | 'BY_SHARES' | 'BY_PERCENTAGE' | 'BY_AMOUNT'
    paidFor: Array<{ participant: string; shares: number }>
  }>
  paidFor?: Array<{ participant: string; shares: number }>
  itemizedRemainder?: {
    splitMode: 'EVENLY' | 'BY_SHARES' | 'BY_PERCENTAGE' | 'BY_AMOUNT'
    paidFor: Array<{ participant: string; shares: number }>
  }
}) {
  const adminId = testGroup.participants[0]?.id ?? ''
  const paidFor = args.paidFor ?? [{ participant: adminId, shares: 1 }]
  return {
    groupId: testGroup.id,
    expense: {
      title: 'Itemized expense',
      amount: args.amount,
      paidByList: [{ participant: adminId, shares: args.amount }],
      paidBySplitMode: 'BY_AMOUNT' as const,
      isMultiPayer: false,
      paidFor,
      splitMode: args.splitMode,
      expenseDate: new Date().toISOString(),
      category: 'general',
      isReimbursement: false,
      saveDefaultSplittingOptions: false,
      recurrenceRule: 'NONE' as const,
      items: args.items,
      ...(args.itemizedRemainder
        ? { itemizedRemainder: args.itemizedRemainder }
        : {}),
    },
  }
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('Expense items — ExpenseCard via existing API', () => {
  beforeAll(async () => {
    sessionCookie = await createTestSession(API_URL, testEmail, testPassword)

    // Create a group with only the admin (groups.create only creates
    // the admin ledger participant; the form `participants` array is
    // currently ignored by the create procedure).
    const createResult = await trpcCall<{ groupId: string }>('groups.create', {
      groupFormValues: {
        name: 'Items Integration Group',
        currency: 'EUR',
        participants: [{ name: 'Admin' }],
      },
    })

    // Add Alice and Bob as unlinked ledger participants via Prisma.
    // The API does not expose a "create unlinked participant" mutation,
    // so we set them up directly. They appear in `groups.get`'s
    // `participants` list with their displayName.
    process.env.DATABASE_URL ??= 'postgresql://postgres:1234@localhost'
    const groupRow = await prisma.group.findUnique({
      where: { id: createResult.groupId },
      include: { ledger: true },
    })
    if (!groupRow?.ledgerId) throw new Error('Group creation failed')

    const alice = await prisma.ledgerParticipant.create({
      data: {
        id: randomId(),
        ledgerId: groupRow.ledgerId,
        kind: 'UNLINKED_PARTICIPANT',
        displayName: 'Alice',
      },
    })
    const bob = await prisma.ledgerParticipant.create({
      data: {
        id: randomId(),
        ledgerId: groupRow.ledgerId,
        kind: 'UNLINKED_PARTICIPANT',
        displayName: 'Bob',
      },
    })
    aliceParticipantId = alice.id
    bobParticipantId = bob.id

    // Refresh the group view so we capture the full participant list.
    const groupResult = await trpcCall<{
      group: TestGroup
      currentLedgerParticipantId: string | null
    }>('groups.get', {
      groupId: createResult.groupId,
      linkInviteToken: undefined,
    })
    testGroup = groupResult.group
  }, 30000)

  afterAll(async () => {
    await cleanupTestAccount(testEmail)
  }, 10000)

  // ── Test 1: render with no items (defensive coverage) ───────────────

  it('renders ExpenseCard without crashing when items is empty', async () => {
    setupGroupContext()

    const { ExpenseCard } =
      await import('@/app/groups/[groupId]/expenses/expense-card')

    const adminId = testGroup.participants[0].id
    render(
      <ExpenseCard
        expense={
          {
            id: 'exp-no-items',
            title: 'No items',
            amount: 1000,
            categoryId: 'general',
            category: {
              id: 'general',
              grouping: 'Uncategorized',
              name: 'General',
            },
            expenseDate: new Date(),
            createdAt: new Date(),
            paidByList: [
              {
                ledgerParticipant: { id: adminId, name: 'Admin' },
                shares: 1000,
              },
            ],
            paidFor: [
              { ledgerParticipant: { id: adminId, name: 'Admin' }, shares: 1 },
            ],
            isReimbursement: false,
            paidBySplitMode: 'BY_AMOUNT',
            splitMode: 'EVENLY',
            recurrenceRule: 'NONE',
            _count: { documents: 0 },
            items: [],
          } as any
        }
        currency={{ symbol: '€', code: 'EUR', rounding: 0, decimal_digits: 2 }}
        groupId={testGroup.id}
        participantCount={1}
      />,
    )

    expect(screen.getByText('No items')).toBeInTheDocument()
    expect(screen.getByTestId('expense-amount')).toHaveTextContent('€10.00')
  })

  // ── Test 2: render with one item (ITEMIZED via API) ─────────────────

  it('renders a single item with title and formatted amount', async () => {
    // Create a real expense with a single item
    const adminId = testGroup.participants[0].id
    const { expenseId } = await trpcCall<{ expenseId: string }>(
      'groups.expenses.create',
      buildExpensePayload({
        amount: 1500,
        splitMode: 'ITEMIZED',
        items: [
          {
            title: 'Pizza',
            unitPrice: 1500,
            quantity: 1,
            amount: 1500,
            splitMode: 'EVENLY',
            paidFor: [
              { participant: adminId, shares: 1 },
              { participant: aliceParticipantId, shares: 1 },
              { participant: bobParticipantId, shares: 1 },
            ],
          },
        ],
      }),
    )

    // Read back via list to get items attached
    const listResult = await trpcCall<{
      expenses: Array<{
        id: string
        items: Array<any>
        title: string
        amount: number
        paidByList: any
        paidFor: any
        expenseDate: string
        createdAt: string
      }>
    }>('groups.expenses.list', {
      groupId: testGroup.id,
      linkInviteToken: undefined,
    })
    const fetched = listResult.expenses.find((e) => e.id === expenseId)!
    expect(fetched.items).toHaveLength(1)
    expect(fetched.items[0].title).toBe('Pizza')
    expect(fetched.items[0].amount).toBe(1500)

    // Normalize dates (API returns ISO strings even though the list
    // procedure tries to wrap them — tRPC + superjson handles this
    // client-side, but we hit the wire format directly).
    const renderable = {
      ...fetched,
      expenseDate: new Date(fetched.expenseDate),
      createdAt: new Date(fetched.createdAt),
    }

    setupGroupContext()

    const { ExpenseCard } =
      await import('@/app/groups/[groupId]/expenses/expense-card')

    render(
      <ExpenseCard
        expense={renderable as any}
        currency={{ symbol: '€', code: 'EUR', rounding: 0, decimal_digits: 2 }}
        groupId={testGroup.id}
        participantCount={3}
      />,
    )

    // The item title is rendered alongside the separator and amount in a
    // single div, so use a regex matcher.
    expect(screen.getByText(/Pizza/)).toBeInTheDocument()
    // Item amount rendered in the ItemsPreview block (also appears in
    // the expense-amount and the balance breakdown)
    expect(screen.getAllByText('€15.00').length).toBeGreaterThan(0)
  })

  // ── Test 3: render with two items (max preview, no overflow) ────────

  it('renders two items without an overflow indicator', async () => {
    const adminId = testGroup.participants[0].id
    const { expenseId } = await trpcCall<{ expenseId: string }>(
      'groups.expenses.create',
      buildExpensePayload({
        amount: 2000,
        splitMode: 'ITEMIZED',
        items: [
          {
            title: 'Bread',
            unitPrice: 800,
            quantity: 1,
            amount: 800,
            splitMode: 'EVENLY',
            paidFor: [{ participant: adminId, shares: 1 }],
          },
          {
            title: 'Cheese',
            unitPrice: 1200,
            quantity: 1,
            amount: 1200,
            splitMode: 'EVENLY',
            paidFor: [{ participant: adminId, shares: 1 }],
          },
        ],
      }),
    )

    const listResult = await trpcCall<{
      expenses: Array<{
        id: string
        items: Array<any>
        title: string
        amount: number
        paidByList: any
        paidFor: any
        expenseDate: string
        createdAt: string
      }>
    }>('groups.expenses.list', {
      groupId: testGroup.id,
      linkInviteToken: undefined,
    })
    const fetched = listResult.expenses.find((e) => e.id === expenseId)!
    const renderable = {
      ...fetched,
      expenseDate: new Date(fetched.expenseDate),
      createdAt: new Date(fetched.createdAt),
    }

    setupGroupContext()

    const { ExpenseCard } =
      await import('@/app/groups/[groupId]/expenses/expense-card')

    render(
      <ExpenseCard
        expense={renderable as any}
        currency={{ symbol: '€', code: 'EUR', rounding: 0, decimal_digits: 2 }}
        groupId={testGroup.id}
        participantCount={3}
      />,
    )

    // Both items rendered
    expect(screen.getByText(/Bread/)).toBeInTheDocument()
    expect(screen.getByText(/Cheese/)).toBeInTheDocument()
    // No overflow indicator (only 2 items, equal to maxPreview)
    expect(screen.queryByText(/more/i)).not.toBeInTheDocument()
  })

  // ── Test 4: render with three items (overflow indicator) ────────────

  it('renders an overflow indicator when there are more than 2 items', async () => {
    const adminId = testGroup.participants[0].id
    const { expenseId } = await trpcCall<{ expenseId: string }>(
      'groups.expenses.create',
      buildExpensePayload({
        amount: 4500,
        splitMode: 'ITEMIZED',
        items: [
          {
            title: 'Apples',
            unitPrice: 1000,
            quantity: 1,
            amount: 1000,
            splitMode: 'EVENLY',
            paidFor: [{ participant: adminId, shares: 1 }],
          },
          {
            title: 'Bananas',
            unitPrice: 1500,
            quantity: 1,
            amount: 1500,
            splitMode: 'EVENLY',
            paidFor: [{ participant: adminId, shares: 1 }],
          },
          {
            title: 'Cherries',
            unitPrice: 2000,
            quantity: 1,
            amount: 2000,
            splitMode: 'EVENLY',
            paidFor: [{ participant: adminId, shares: 1 }],
          },
        ],
      }),
    )

    const listResult = await trpcCall<{
      expenses: Array<{
        id: string
        items: Array<any>
        title: string
        amount: number
        paidByList: any
        paidFor: any
        expenseDate: string
        createdAt: string
      }>
    }>('groups.expenses.list', {
      groupId: testGroup.id,
      linkInviteToken: undefined,
    })
    const fetched = listResult.expenses.find((e) => e.id === expenseId)!
    expect(fetched.items).toHaveLength(3)
    const renderable = {
      ...fetched,
      expenseDate: new Date(fetched.expenseDate),
      createdAt: new Date(fetched.createdAt),
    }

    setupGroupContext()

    const { ExpenseCard } =
      await import('@/app/groups/[groupId]/expenses/expense-card')

    render(
      <ExpenseCard
        expense={renderable as any}
        currency={{ symbol: '€', code: 'EUR', rounding: 0, decimal_digits: 2 }}
        groupId={testGroup.id}
        participantCount={3}
      />,
    )

    // Only the first two items are previewed in the card
    const card = screen.getByTestId(`expense-item-${expenseId}`)
    expect(within(card).getByText(/Apples/)).toBeInTheDocument()
    expect(within(card).getByText(/Bananas/)).toBeInTheDocument()
    // The third item is hidden behind the "+1 more" indicator
    expect(within(card).queryByText(/Cherries/)).not.toBeInTheDocument()
    // Overflow indicator is rendered
    expect(within(card).getByText(/more/i)).toBeInTheDocument()
  })

  // ── Test 5: items survive a list round-trip via the API ──────────────

  it('persists and returns item paidFor participants with correct shares', async () => {
    const adminId = testGroup.participants[0].id
    // Item A: $30 evenly split Admin + Alice (each gets 1500 cents)
    // Item B: $20 split 1:3 by shares between Admin and Bob (Admin=5000, Bob=15000)
    const { expenseId } = await trpcCall<{ expenseId: string }>(
      'groups.expenses.create',
      buildExpensePayload({
        amount: 5000,
        splitMode: 'ITEMIZED',
        items: [
          {
            title: 'Item A',
            unitPrice: 3000,
            quantity: 1,
            amount: 3000,
            splitMode: 'EVENLY',
            paidFor: [
              { participant: adminId, shares: 1 },
              { participant: aliceParticipantId, shares: 1 },
            ],
          },
          {
            title: 'Item B',
            unitPrice: 2000,
            quantity: 1,
            amount: 2000,
            splitMode: 'BY_SHARES',
            paidFor: [
              { participant: adminId, shares: 1 },
              { participant: bobParticipantId, shares: 3 },
            ],
          },
        ],
      }),
    )

    // Fetch via the .get procedure (single expense). Note: the get
    // endpoint returns raw Prisma row shape for items.paidFor
    // (`ledgerParticipantId`), while the list endpoint transforms to
    // `{ participant, shares }`.
    const getResult = await trpcCall<{
      expense: {
        items: Array<{
          title: string
          amount: number
          splitMode: string
          paidFor: Array<{ ledgerParticipantId: string; shares: number }>
        }>
        paidFor: Array<{ shares: number }>
      }
    }>('groups.expenses.get', { groupId: testGroup.id, expenseId })

    // Both items persisted with their paidFor rows intact
    expect(getResult.expense.items).toHaveLength(2)

    const itemA = getResult.expense.items.find((i) => i.title === 'Item A')!
    expect(itemA.amount).toBe(3000)
    expect(itemA.paidFor).toHaveLength(2)
    expect(itemA.splitMode).toBe('EVENLY')

    const itemB = getResult.expense.items.find((i) => i.title === 'Item B')!
    expect(itemB.amount).toBe(2000)
    expect(itemB.paidFor).toHaveLength(2)
    expect(itemB.splitMode).toBe('BY_SHARES')
    expect(
      itemB.paidFor.find((pf) => pf.ledgerParticipantId === bobParticipantId)
        ?.shares,
    ).toBe(3)

    // Expense-level paidFor is the derived distribution; shares sum to amount
    const sharesSum = getResult.expense.paidFor.reduce(
      (s, p) => s + p.shares,
      0,
    )
    expect(sharesSum).toBe(5000)
  })

  // ── Test 6: update replaces items (delete stale + add new) ──────────

  it('replaces items when the expense is updated via the API', async () => {
    const adminId = testGroup.participants[0].id
    // Step 1: create with two items
    const { expenseId } = await trpcCall<{ expenseId: string }>(
      'groups.expenses.create',
      buildExpensePayload({
        amount: 3000,
        splitMode: 'ITEMIZED',
        items: [
          {
            title: 'Old item 1',
            unitPrice: 1500,
            quantity: 1,
            amount: 1500,
            splitMode: 'EVENLY',
            paidFor: [{ participant: adminId, shares: 1 }],
          },
          {
            title: 'Old item 2',
            unitPrice: 1500,
            quantity: 1,
            amount: 1500,
            splitMode: 'EVENLY',
            paidFor: [{ participant: adminId, shares: 1 }],
          },
        ],
      }),
    )

    // Step 2: update with a single new item (the two old ones should be gone)
    await trpcCall('groups.expenses.update', {
      groupId: testGroup.id,
      expenseId,
      expense: {
        title: 'Itemized expense',
        amount: 4000,
        paidByList: [{ participant: adminId, shares: 4000 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: adminId, shares: 1 }],
        splitMode: 'ITEMIZED',
        expenseDate: new Date().toISOString(),
        category: 'general',
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        recurrenceRule: 'NONE',
        items: [
          {
            title: 'Replacement item',
            unitPrice: 4000,
            quantity: 1,
            amount: 4000,
            splitMode: 'EVENLY',
            paidFor: [{ participant: adminId, shares: 1 }],
          },
        ],
      },
    })

    // Step 3: verify only the new item remains
    const getResult = await trpcCall<{
      expense: { items: Array<{ title: string }> }
    }>('groups.expenses.get', { groupId: testGroup.id, expenseId })
    expect(getResult.expense.items).toHaveLength(1)
    expect(getResult.expense.items[0].title).toBe('Replacement item')
  })
})
