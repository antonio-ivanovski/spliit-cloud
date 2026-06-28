import { prisma } from '@spliit/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { groupsRouter } from '../trpc/routers/groups'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

describe('Expense CRUD — real DB', () => {
  const runId = testRunId()
  const adminId = `acct-exp-${runId}`
  const adminEmail = `exp-${runId}@test.example`

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

  /** Helper: create a group and return its id + the admin's ledger participant id. */
  async function createGroup(
    name: string,
  ): Promise<{ groupId: string; participantId: string }> {
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
    trackLedger(group!.ledger.id)
    return { groupId, participantId: group!.members[0].ledgerParticipant!.id }
  }

  // ------------------------------------------------------------------
  // 1. Create expense with EVENLY split mode
  // ------------------------------------------------------------------
  it('creates an expense with EVENLY split mode', async () => {
    const caller = makeCaller()
    const { groupId, participantId } = await createGroup(`Evenly ${runId}`)

    const result = await caller.expenses.create({
      groupId,
      expenseFormValues: {
        title: 'Even Split',
        amount: 4000,
        paidBy: participantId,
        paidFor: [{ participant: participantId, shares: 1 }],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })
    expect(result).toHaveProperty('expenseId')

    const expense = await prisma.expense.findUnique({
      where: { id: result.expenseId },
    })
    expect(expense!.splitMode).toBe('EVENLY')
    expect(expense!.amount).toBe(4000)
  })

  // ------------------------------------------------------------------
  // 2. Create expense with BY_AMOUNT split mode
  // ------------------------------------------------------------------
  it('creates an expense with BY_AMOUNT split mode', async () => {
    const caller = makeCaller()
    const { groupId, participantId } = await createGroup(`ByAmount ${runId}`)

    const result = await caller.expenses.create({
      groupId,
      expenseFormValues: {
        title: 'By Amount Split',
        amount: 3000,
        paidBy: participantId,
        paidFor: [{ participant: participantId, shares: 3000 }],
        category: 'general',
        splitMode: 'BY_AMOUNT',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })
    expect(result).toHaveProperty('expenseId')

    const expense = await prisma.expense.findUnique({
      where: { id: result.expenseId },
      include: { paidFor: true },
    })
    expect(expense!.splitMode).toBe('BY_AMOUNT')
    expect(expense!.paidFor[0].shares).toBe(3000)
  })

  // ------------------------------------------------------------------
  // 3. Create expense with BY_PERCENTAGE split mode
  // ------------------------------------------------------------------
  it('creates an expense with BY_PERCENTAGE split mode', async () => {
    const caller = makeCaller()
    const { groupId, participantId } = await createGroup(`ByPercent ${runId}`)

    const result = await caller.expenses.create({
      groupId,
      expenseFormValues: {
        title: 'Percent Split',
        amount: 5000,
        paidBy: participantId,
        paidFor: [
          { participant: participantId, shares: 10000 }, // 100%
        ],
        category: 'general',
        splitMode: 'BY_PERCENTAGE',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })
    expect(result).toHaveProperty('expenseId')

    const expense = await prisma.expense.findUnique({
      where: { id: result.expenseId },
    })
    expect(expense!.splitMode).toBe('BY_PERCENTAGE')
  })

  // ------------------------------------------------------------------
  // 4. Create expense with BY_SHARES split mode
  // ------------------------------------------------------------------
  it('creates an expense with BY_SHARES split mode', async () => {
    const caller = makeCaller()
    const { groupId, participantId } = await createGroup(`ByShares ${runId}`)

    const result = await caller.expenses.create({
      groupId,
      expenseFormValues: {
        title: 'Shares Split',
        amount: 6000,
        paidBy: participantId,
        paidFor: [
          { participant: participantId, shares: 500 }, // 500 shares (number*100 after transform)
        ],
        category: 'general',
        splitMode: 'BY_SHARES',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })
    expect(result).toHaveProperty('expenseId')

    const expense = await prisma.expense.findUnique({
      where: { id: result.expenseId },
    })
    expect(expense!.splitMode).toBe('BY_SHARES')
  })

  // ------------------------------------------------------------------
  // 5. Update expense title
  // ------------------------------------------------------------------
  it('updates an expense title', async () => {
    const caller = makeCaller()
    const { groupId, participantId } = await createGroup(`Update ${runId}`)

    // Create expense
    const { expenseId } = await caller.expenses.create({
      groupId,
      expenseFormValues: {
        title: 'Original Title',
        amount: 1000,
        paidBy: participantId,
        paidFor: [{ participant: participantId, shares: 1 }],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    // Update title
    await caller.expenses.update({
      groupId,
      expenseId,
      expenseFormValues: {
        title: 'Updated Title',
        amount: 1000,
        paidBy: participantId,
        paidFor: [{ participant: participantId, shares: 1 }],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    const expense = await prisma.expense.findUnique({
      where: { id: expenseId },
    })
    expect(expense!.title).toBe('Updated Title')
  })

  // ------------------------------------------------------------------
  // 6. Delete expense
  // ------------------------------------------------------------------
  it('deletes an expense', async () => {
    const caller = makeCaller()
    const { groupId, participantId } = await createGroup(`Delete ${runId}`)

    const { expenseId } = await caller.expenses.create({
      groupId,
      expenseFormValues: {
        title: 'To Delete',
        amount: 2000,
        paidBy: participantId,
        paidFor: [{ participant: participantId, shares: 1 }],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    // Verify it exists
    let expense = await prisma.expense.findUnique({ where: { id: expenseId } })
    expect(expense).not.toBeNull()

    // Delete
    await caller.expenses.delete({ groupId, expenseId })

    // Verify removed
    expense = await prisma.expense.findUnique({ where: { id: expenseId } })
    expect(expense).toBeNull()
  })

  // ------------------------------------------------------------------
  // 7. Create expense with empty documents array
  // ------------------------------------------------------------------
  it('creates an expense with an empty documents array', async () => {
    const caller = makeCaller()
    const { groupId, participantId } = await createGroup(`NoDocs ${runId}`)

    const result = await caller.expenses.create({
      groupId,
      expenseFormValues: {
        title: 'No Documents',
        amount: 1500,
        paidBy: participantId,
        paidFor: [{ participant: participantId, shares: 1 }],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    const expense = await prisma.expense.findUnique({
      where: { id: result.expenseId },
    })
    expect(expense).not.toBeNull()
    expect(expense!.title).toBe('No Documents')
  })
})
