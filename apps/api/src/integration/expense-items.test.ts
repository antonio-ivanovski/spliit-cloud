import { prisma } from '@spliit/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomId } from '../lib/api'
import { groupsRouter } from '../trpc/routers/groups'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

describe('Expense items — real DB', () => {
  const runId = testRunId()
  const adminId = `acct-ei-${runId}`
  const adminEmail = `ei-${runId}@test.example`

  const ledgerIds: string[] = []

  function trackLedger(id: string) {
    ledgerIds.push(id)
  }

  function makeCaller() {
    return groupsRouter.createCaller({
      auth: {
        session: { id: 'sess-test' },
        user: {
          id: adminId,
          email: adminEmail,
          emailVerified: true,
          name: 'Test Admin',
        },
      },
    } as never)
  }

  beforeAll(async () => {
    await prisma.account.upsert({
      where: { email: adminEmail },
      update: {},
      create: {
        id: adminId,
        email: adminEmail,
        emailVerified: true,
        name: 'Test Admin',
      },
    })
  })

  afterAll(async () => {
    for (const lid of ledgerIds) {
      await prisma.ledger.delete({ where: { id: lid } }).catch(() => {})
    }
    await prisma.account.delete({ where: { id: adminId } }).catch(() => {})
  })

  async function createGroupWithMembers(
    name: string,
    memberNames: string[],
  ): Promise<{
    groupId: string
    participants: Record<string, string>
  }> {
    const caller = makeCaller()
    const { groupId } = await caller.create({
      groupFormValues: {
        name,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Admin' }],
      },
    })

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        ledger: true,
        members: { include: { ledgerParticipant: true } },
      },
    })

    const ledgerId = group!.ledger.id
    trackLedger(ledgerId)

    const adminLpId = group!.members[0].ledgerParticipant!.id
    const participants: Record<string, string> = { Admin: adminLpId }

    for (const name of memberNames) {
      const lp = await prisma.ledgerParticipant.create({
        data: {
          id: randomId(),
          ledgerId,
          kind: 'UNLINKED_PARTICIPANT',
          displayName: name,
        },
      })
      participants[name] = lp.id
    }

    return { groupId, participants }
  }

  async function readExpenseItems(expenseId: string) {
    return prisma.expense.findUnique({
      where: { id: expenseId },
      include: {
        paidFor: true,
        items: {
          include: { paidFor: true },
        },
      },
    })
  }

  // ------------------------------------------------------------------
  // 1. CREATE: splitMode=ITEMIZED with 2 items, paidFor derived
  // ------------------------------------------------------------------
  it('creates with ITEMIZED mode and derives paidFor from items', async () => {
    const { groupId, participants } = await createGroupWithMembers(
      `Itemized-Derive-${runId}`,
      ['Alice', 'Bob', 'Charlie'],
    )

    const expense = await makeCaller().expenses.create({
      groupId,
      expense: {
        title: 'Itemized groceries',
        amount: 10000,
        paidByList: [{ participant: participants['Admin'], shares: 10000 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participants['Admin'], shares: 1 }],
        category: 'general',
        splitMode: 'ITEMIZED',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
        items: [
          {
            title: 'Item A',
            unitPrice: 3000,
            quantity: 1,
            amount: 3000,
            splitMode: 'EVENLY',
            paidFor: [
              { participant: participants['Admin'], shares: 1 },
              { participant: participants['Alice'], shares: 1 },
              { participant: participants['Bob'], shares: 1 },
            ],
          },
          {
            title: 'Item B',
            unitPrice: 7000,
            quantity: 1,
            amount: 7000,
            splitMode: 'BY_SHARES',
            paidFor: [
              { participant: participants['Admin'], shares: 2 },
              { participant: participants['Alice'], shares: 1 },
            ],
          },
        ],
      },
    })

    const saved = await readExpenseItems(expense.expenseId)
    expect(saved).not.toBeNull()

    // paidFor rows = participants covered by items (3 of 4; items sum = amount, no filler)
    expect(saved!.paidFor.length).toBe(3)
    expect(saved!.splitMode).toBe('ITEMIZED')

    // Items persisted
    expect(saved!.items).toHaveLength(2)

    // Item A: $30 evenly split 3 ways
    const itemA = saved!.items.find((i) => i.title === 'Item A')!
    expect(itemA.amount).toBe(3000)
    expect(itemA.paidFor).toHaveLength(3)

    // Item B: $70 split 2:1 (BY_SHARES)
    const itemB = saved!.items.find((i) => i.title === 'Item B')!
    expect(itemB.amount).toBe(7000)
    expect(itemB.paidFor).toHaveLength(2)

    // Verify paidFor rows (3 participants covered by items, shares = exact cents)
    const sharesSum = saved!.paidFor.reduce((s, p) => s + p.shares, 0)
    expect(sharesSum).toBe(10000)
    // Admin: 1000 (Item A EVENLY) + 4666 (Item B BY_SHARES 2/3) = 5666
    // Alice: 1000 (Item A) + 2334 (Item B last) = 3334
    // Bob: 1000 (Item A)
    expect(saved!.paidFor.sort()).toContainEqual(
      expect.objectContaining({ shares: 5666 }),
    )
    expect(saved!.paidFor.sort()).toContainEqual(
      expect.objectContaining({ shares: 3334 }),
    )
    expect(saved!.paidFor.sort()).toContainEqual(
      expect.objectContaining({ shares: 1000 }),
    )
  })

  // ------------------------------------------------------------------
  // 2. CREATE: ITEMIZED + items sum < amount => filler applied
  // ------------------------------------------------------------------
  it('creates with ITEMIZED and applies filler when items sum < amount', async () => {
    const { groupId, participants } = await createGroupWithMembers(
      `Itemized-Filler-${runId}`,
      ['Alice', 'Bob', 'Charlie'],
    )

    const ids = [
      participants['Admin'],
      participants['Alice'],
      participants['Bob'],
      participants['Charlie'],
    ]

    const expense = await makeCaller().expenses.create({
      groupId,
      expense: {
        title: 'Under-sum items',
        amount: 10000,
        paidByList: [{ participant: participants['Admin'], shares: 10000 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participants['Admin'], shares: 1 }],
        category: 'general',
        splitMode: 'ITEMIZED',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
        items: [
          {
            title: 'Small item',
            unitPrice: 6000,
            quantity: 1,
            amount: 6000,
            splitMode: 'EVENLY',
            paidFor: [
              { participant: participants['Admin'], shares: 1 },
              { participant: participants['Alice'], shares: 1 },
            ],
          },
        ],
      },
    })

    const saved = await readExpenseItems(expense.expenseId)
    expect(saved).not.toBeNull()
    expect(saved!.paidFor.length).toBe(4)

    // Sum of item amounts + filler must equal expense amount
    const itemSum = saved!.items.reduce((s, i) => s + i.amount, 0)
    expect(itemSum).toBe(6000)
    expect(saved!.amount).toBe(10000)

    // PaidFor shares sum to expense amount in cents
    const sharesSum = saved!.paidFor.reduce((s, p) => s + p.shares, 0)
    expect(sharesSum).toBe(10000)
  })

  // ------------------------------------------------------------------
  // 3. CREATE: EVENLY + items (documentation only)
  // ------------------------------------------------------------------
  it('creates with EVENLY mode and items as documentation', async () => {
    const { groupId, participants } = await createGroupWithMembers(
      `Evenly-Docs-${runId}`,
      ['Alice', 'Bob', 'Charlie'],
    )

    const expense = await makeCaller().expenses.create({
      groupId,
      expense: {
        title: 'Evenly with doc items',
        amount: 5000,
        paidByList: [{ participant: participants['Admin'], shares: 5000 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [
          { participant: participants['Admin'], shares: 1 },
          { participant: participants['Alice'], shares: 1 },
          { participant: participants['Bob'], shares: 1 },
          { participant: participants['Charlie'], shares: 1 },
        ],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
        items: [
          {
            title: 'Doc item',
            unitPrice: 2000,
            quantity: 1,
            amount: 2000,
            splitMode: 'EVENLY',
            paidFor: [{ participant: participants['Admin'], shares: 1 }],
          },
        ],
      },
    })

    const saved = await readExpenseItems(expense.expenseId)
    expect(saved).not.toBeNull()

    // paidFor is the EVENLY split (4 rows, shares=1)
    expect(saved!.paidFor).toHaveLength(4)
    for (const pf of saved!.paidFor) {
      expect(pf.shares).toBe(1)
    }

    // Items persisted
    expect(saved!.items).toHaveLength(1)
    expect(saved!.items[0].title).toBe('Doc item')
    expect(saved!.items[0].paidFor).toHaveLength(1)
  })

  // ------------------------------------------------------------------
  // 4. UPDATE: leaving ITEMIZED for EVENLY clears item participants
  // ------------------------------------------------------------------
  it('update leaving ITEMIZED for EVENLY clears item paidFor', async () => {
    const { groupId, participants } = await createGroupWithMembers(
      `LeaveItemized-${runId}`,
      ['Alice', 'Bob', 'Charlie'],
    )

    const ids = [
      participants['Admin'],
      participants['Alice'],
      participants['Bob'],
      participants['Charlie'],
    ]

    // Create in ITEMIZED with items having participants
    const { expenseId } = await makeCaller().expenses.create({
      groupId,
      expense: {
        title: 'Itemized to even',
        amount: 8000,
        paidByList: [{ participant: participants['Admin'], shares: 8000 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participants['Admin'], shares: 1 }],
        category: 'general',
        splitMode: 'ITEMIZED',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
        items: [
          {
            title: 'Item with participants',
            unitPrice: 8000,
            quantity: 1,
            amount: 8000,
            splitMode: 'EVENLY',
            paidFor: [
              { participant: participants['Admin'], shares: 1 },
              { participant: participants['Alice'], shares: 1 },
            ],
          },
        ],
      },
    })

    // Verify items have paidFor
    let saved = await readExpenseItems(expenseId)
    expect(saved!.items[0].paidFor).toHaveLength(2)

    // Update to EVENLY (leaving ITEMIZED)
    await makeCaller().expenses.update({
      groupId,
      expenseId,
      expense: {
        title: 'Itemized to even - updated',
        amount: 8000,
        paidByList: [{ participant: participants['Admin'], shares: 8000 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [
          { participant: participants['Admin'], shares: 1 },
          { participant: participants['Alice'], shares: 1 },
          { participant: participants['Bob'], shares: 1 },
          { participant: participants['Charlie'], shares: 1 },
        ],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
        items: [
          {
            id: saved!.items[0].id,
            title: 'Item with participants',
            unitPrice: 8000,
            quantity: 1,
            amount: 8000,
            splitMode: 'EVENLY',
            paidFor: [],
          },
        ],
      },
    })

    saved = await readExpenseItems(expenseId)
    // Items remain
    expect(saved!.items).toHaveLength(1)
    // But their paidFor is empty
    expect(saved!.items[0].paidFor).toHaveLength(0)
    // Expense-level paidFor is the EVENLY split
    expect(saved!.paidFor).toHaveLength(4)
  })

  // ------------------------------------------------------------------
  // 5. UPDATE: staying in ITEMIZED updates items
  // ------------------------------------------------------------------
  it('update staying in ITEMIZED replaces items correctly', async () => {
    const { groupId, participants } = await createGroupWithMembers(
      `StayItemized-${runId}`,
      ['Alice', 'Bob', 'Charlie'],
    )

    const ids = [
      participants['Admin'],
      participants['Alice'],
      participants['Bob'],
      participants['Charlie'],
    ]

    // Create in ITEMIZED with 1 item
    const { expenseId } = await makeCaller().expenses.create({
      groupId,
      expense: {
        title: 'Itemized stay',
        amount: 5000,
        paidByList: [{ participant: participants['Admin'], shares: 5000 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participants['Admin'], shares: 1 }],
        category: 'general',
        splitMode: 'ITEMIZED',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
        items: [
          {
            title: 'First item',
            unitPrice: 5000,
            quantity: 1,
            amount: 5000,
            splitMode: 'EVENLY',
            paidFor: [
              { participant: participants['Admin'], shares: 1 },
              { participant: participants['Alice'], shares: 1 },
            ],
          },
        ],
      },
    })

    // Update with different items (replace first, add second)
    await makeCaller().expenses.update({
      groupId,
      expenseId,
      expense: {
        title: 'Itemized stay - updated',
        amount: 10000,
        paidByList: [{ participant: participants['Admin'], shares: 10000 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participants['Admin'], shares: 1 }],
        category: 'general',
        splitMode: 'ITEMIZED',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
        items: [
          {
            title: 'Second item',
            unitPrice: 7000,
            quantity: 1,
            amount: 7000,
            splitMode: 'EVENLY',
            paidFor: [
              { participant: participants['Admin'], shares: 1 },
              { participant: participants['Bob'], shares: 1 },
            ],
          },
          {
            title: 'Third item',
            unitPrice: 3000,
            quantity: 1,
            amount: 3000,
            splitMode: 'EVENLY',
            paidFor: [
              { participant: participants['Admin'], shares: 1 },
              { participant: participants['Charlie'], shares: 1 },
            ],
          },
        ],
      },
    })

    const saved = await readExpenseItems(expenseId)
    // First item should be gone (replaced by second + third)
    expect(saved!.items).toHaveLength(2)
    expect(saved!.items.find((i) => i.title === 'First item')).toBeUndefined()
    expect(saved!.items.find((i) => i.title === 'Second item')).toBeDefined()
    expect(saved!.items.find((i) => i.title === 'Third item')).toBeDefined()
  })

  // ------------------------------------------------------------------
  // 6. CREATE: items sum exceeds amount => rejected
  // ------------------------------------------------------------------
  it('rejects ITEMIZED create when items sum exceeds amount', async () => {
    const { groupId, participants } = await createGroupWithMembers(
      `Itemized-Exceed-${runId}`,
      ['Alice'],
    )

    await expect(
      makeCaller().expenses.create({
        groupId,
        expense: {
          title: 'Over budget',
          amount: 5000,
          paidByList: [{ participant: participants['Admin'], shares: 5000 }],
          paidBySplitMode: 'BY_AMOUNT',
          isMultiPayer: false,
          paidFor: [{ participant: participants['Admin'], shares: 1 }],
          category: 'general',
          splitMode: 'ITEMIZED',
          expenseDate: new Date().toISOString(),
          isReimbursement: false,
          saveDefaultSplittingOptions: false,
          documents: [],
          recurrenceRule: 'NONE',
          items: [
            {
              title: 'Expensive item',
              unitPrice: 6000,
              quantity: 1,
              amount: 6000,
              splitMode: 'EVENLY',
              paidFor: [{ participant: participants['Admin'], shares: 1 }],
            },
          ],
        },
      }),
    ).rejects.toThrow(/itemsExceedAmount|ITEMS_EXCEED_AMOUNT/i)
  })

  // ------------------------------------------------------------------
  // 7. CREATE: ITEMIZED with no items => rejected
  // ------------------------------------------------------------------
  it('rejects ITEMIZED create with no items', async () => {
    const { groupId, participants } = await createGroupWithMembers(
      `Itemized-NoItems-${runId}`,
      ['Alice'],
    )

    await expect(
      makeCaller().expenses.create({
        groupId,
        expense: {
          title: 'No items',
          amount: 5000,
          paidByList: [{ participant: participants['Admin'], shares: 5000 }],
          paidBySplitMode: 'BY_AMOUNT',
          isMultiPayer: false,
          paidFor: [{ participant: participants['Admin'], shares: 1 }],
          category: 'general',
          splitMode: 'ITEMIZED',
          expenseDate: new Date().toISOString(),
          isReimbursement: false,
          saveDefaultSplittingOptions: false,
          documents: [],
          recurrenceRule: 'NONE',
          items: [],
        },
      }),
    ).rejects.toThrow(/itemizedRequiresItems/i)
  })

  // ------------------------------------------------------------------
  // 8. GET / LIST return items with paidFor
  // ------------------------------------------------------------------
  it('get and list return items with paidFor', async () => {
    const { groupId, participants } = await createGroupWithMembers(
      `Itemized-GetList-${runId}`,
      ['Alice'],
    )

    const { expenseId } = await makeCaller().expenses.create({
      groupId,
      expense: {
        title: 'Get/List test',
        amount: 3000,
        paidByList: [{ participant: participants['Admin'], shares: 3000 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participants['Admin'], shares: 1 }],
        category: 'general',
        splitMode: 'ITEMIZED',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
        items: [
          {
            title: 'List item',
            unitPrice: 3000,
            quantity: 1,
            amount: 3000,
            splitMode: 'EVENLY',
            paidFor: [
              { participant: participants['Admin'], shares: 1 },
              { participant: participants['Alice'], shares: 1 },
            ],
          },
        ],
      },
    })

    // get
    const getResult = await makeCaller().expenses.get({
      groupId,
      expenseId,
    })
    expect(getResult.expense).toBeDefined()
    expect(getResult.expense).toHaveProperty('items')
    expect(getResult.expense.items).toHaveLength(1)
    expect(getResult.expense.items[0].title).toBe('List item')
    expect(getResult.expense.items[0].paidFor).toHaveLength(2)

    // list
    const listResult = await makeCaller().expenses.list({
      groupId,
    })
    expect(listResult.expenses).toHaveLength(1)
    const listed = listResult.expenses[0]
    expect(listed).toHaveProperty('items')
    expect(listed.items).toHaveLength(1)
    expect(listed.items[0].title).toBe('List item')
  })
})
