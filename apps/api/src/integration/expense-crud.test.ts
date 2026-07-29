import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prisma } from '@spliit/db'

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

  /**
   * Helper: create a group and return its id + the admin's ledger participant
   * id.
   */
  async function createGroup(
    name: string,
    currency: { symbol: string; code: string } = { symbol: '$', code: 'USD' },
  ): Promise<{ groupId: string; participantId: string }> {
    const caller = makeCaller()
    const { groupId } = await caller.create({
      groupFormValues: {
        name,
        currency: currency.symbol,
        currencyCode: currency.code,
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
  // 5. Update expense title
  // ------------------------------------------------------------------
  it('updates an expense title', async () => {
    const caller = makeCaller()
    const { groupId, participantId } = await createGroup(`Update ${runId}`)

    // Create expense
    const { expenseId } = await caller.expenses.create({
      groupId,
      expense: {
        title: 'Original Title',
        amount: 1000,
        paidByList: [{ participant: participantId, shares: 1000 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participantId, shares: 1 }],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    // Update title
    await caller.expenses.update({
      groupId,
      expenseId,
      expense: {
        title: 'Updated Title',
        amount: 1000,
        paidByList: [{ participant: participantId, shares: 1000 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participantId, shares: 1 }],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    const expense = await prisma.expense.findUnique({
      where: { id: expenseId },
    })
    expect(expense!.title).toBe('Updated Title')
  })

  it('clears original currency metadata when updating back to group currency', async () => {
    const caller = makeCaller()
    const { groupId, participantId } = await createGroup(`Currency ${runId}`, {
      symbol: '€',
      code: 'EUR',
    })

    const { expenseId } = await caller.expenses.create({
      groupId,
      expense: {
        title: 'Dinner',
        amount: 1000,
        paidByList: [{ participant: participantId, shares: 1000 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participantId, shares: 1 }],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    await caller.expenses.update({
      groupId,
      expenseId,
      expense: {
        title: 'Dinner',
        amount: 1000,
        conversion: { type: 'custom', currency: 'USD', rate: 0.92 },
        paidByList: [{ participant: participantId, shares: 1000 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participantId, shares: 1 }],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    await caller.expenses.update({
      groupId,
      expenseId,
      expense: {
        title: 'Dinner',
        amount: 1200,
        paidByList: [{ participant: participantId, shares: 1200 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participantId, shares: 1 }],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    const expense = await prisma.expense.findUnique({
      where: { id: expenseId },
      select: {
        amount: true,
        originalAmount: true,
        originalCurrency: true,
        conversionRate: true,
      },
    })

    expect(expense).toEqual({
      amount: 1200,
      originalAmount: null,
      originalCurrency: null,
      conversionRate: null,
    })
  })

  // ------------------------------------------------------------------
  // 6. Delete expense
  // ------------------------------------------------------------------
  it('deletes an expense', async () => {
    const caller = makeCaller()
    const { groupId, participantId } = await createGroup(`Delete ${runId}`)

    const { expenseId } = await caller.expenses.create({
      groupId,
      expense: {
        title: 'To Delete',
        amount: 2000,
        paidByList: [{ participant: participantId, shares: 2000 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participantId, shares: 1 }],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
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
      expense: {
        title: 'No Documents',
        amount: 1500,
        paidByList: [{ participant: participantId, shares: 1500 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participantId, shares: 1 }],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
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
