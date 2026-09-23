import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prisma } from '@spliit/db'

import { randomId } from '../lib/api'
import { groupsRouter } from '../trpc/routers/groups'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

/**
 * Regression tests for
 * https://github.com/antonio-ivanovski/spliit-cloud/issues/128 "[Bug] Invalid
 * Participant ID Error" when editing an existing transaction.
 *
 * Reporter: self-hosted instance, itemized split, suspected participant
 * deletion between creation and edit. Even a no-op resave fails.
 *
 * Expected (desired) behavior: editing an expense that still references a
 * soft-removed participant (`removedAt != null`) must not throw `Invalid
 * participant ID`. The read path (`getExpense`) returns those IDs and the edit
 * form round-trips them verbatim, so update validation must grandfather them
 * (and/or allow settlements with removed participants, mirroring create).
 *
 * These tests currently FAIL with `Invalid participant ID: <id>` — that failure
 * is the reproduction. Do not fix `update-expense.ts` yet.
 */
describe('Issue #128 — update expense with removed participant — real DB', () => {
  const runId = testRunId()
  const adminId = `acct-128-${runId}`
  const adminEmail = `issue128-${runId}@test.example`

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
    await prisma.user.upsert({
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
    await prisma.user.delete({ where: { id: adminId } }).catch(() => {})
  })

  async function createGroupWithMembers(
    name: string,
    memberNames: string[],
  ): Promise<{ groupId: string; participants: Record<string, string> }> {
    const caller = makeCaller()
    const { groupId } = await caller.create({
      requestId: crypto.randomUUID(),
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
    for (const memberName of memberNames) {
      const lp = await prisma.ledgerParticipant.create({
        data: {
          id: randomId(),
          ledgerId,
          kind: 'UNLINKED_PARTICIPANT',
          displayName: memberName,
        },
      })
      participants[memberName] = lp.id
    }
    return { groupId, participants }
  }

  it('EVENLY no-op resave after participant removal does not throw Invalid participant ID', async () => {
    const { groupId, participants } = await createGroupWithMembers(
      `Issue128-Evenly-${runId}`,
      ['Alice'],
    )
    const caller = makeCaller()
    const baseExpense = {
      title: 'Dinner',
      amount: 2000,
      paidByList: [{ participant: participants['Admin'], shares: 2000 }],
      paidBySplitMode: 'BY_AMOUNT' as const,
      isMultiPayer: false,
      paidFor: [
        { participant: participants['Admin'], shares: 1 },
        { participant: participants['Alice'], shares: 1 },
      ],
      category: 'general' as const,
      splitMode: 'EVENLY' as const,
      expenseDate: new Date().toISOString(),
      expenseTimeZone: 'UTC',
      documents: [],
      recurrenceRule: 'NONE' as const,
    }
    const { expenseId } = await caller.expenses.create({
      requestId: crypto.randomUUID(),
      groupId,
      expense: baseExpense,
    })

    // Simulate "deletion might have happened": soft-remove Alice after creation.
    await prisma.ledgerParticipant.update({
      where: { id: participants['Alice'] },
      data: { removedAt: new Date() },
    })

    const row = await prisma.expense.findUniqueOrThrow({
      where: { id: expenseId },
      select: { version: true },
    })

    // No-op resave with identical participant IDs (what the edit form sends).
    await caller.expenses.update({
      expectedVersion: row.version,
      groupId,
      expenseId,
      expense: { ...baseExpense, title: 'Dinner' },
    })

    const stored = await prisma.expense.findUniqueOrThrow({
      where: { id: expenseId },
    })
    expect(stored.title).toBe('Dinner')
  })

  it('ITEMIZED no-op resave after participant removal does not throw Invalid participant ID', async () => {
    const { groupId, participants } = await createGroupWithMembers(
      `Issue128-Itemized-${runId}`,
      ['Alice', 'Bob'],
    )
    const caller = makeCaller()
    const { expenseId } = await caller.expenses.create({
      requestId: crypto.randomUUID(),
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
        expenseTimeZone: 'UTC',
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
            ],
          },
          {
            title: 'Item B',
            unitPrice: 7000,
            quantity: 1,
            amount: 7000,
            splitMode: 'EVENLY',
            paidFor: [
              { participant: participants['Admin'], shares: 1 },
              { participant: participants['Bob'], shares: 1 },
            ],
          },
        ],
      },
    })

    // Frontend round-trips stored item IDs on edit — fetch them first.
    const saved = await prisma.expense.findUniqueOrThrow({
      where: { id: expenseId },
      include: { items: { include: { paidFor: true } } },
    })
    const itemA = saved.items.find((i) => i.title === 'Item A')!
    const itemB = saved.items.find((i) => i.title === 'Item B')!

    // Participant deletion happens after creation (and after a successful edit).
    await prisma.ledgerParticipant.update({
      where: { id: participants['Alice'] },
      data: { removedAt: new Date() },
    })

    const row = await prisma.expense.findUniqueOrThrow({
      where: { id: expenseId },
      select: { version: true },
    })

    // No-op resave: same items, same participant IDs, same item IDs.
    await caller.expenses.update({
      expectedVersion: row.version,
      groupId,
      expenseId,
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
        expenseTimeZone: 'UTC',
        documents: [],
        recurrenceRule: 'NONE',
        items: [
          {
            id: itemA.id,
            title: 'Item A',
            unitPrice: 3000,
            quantity: 1,
            amount: 3000,
            splitMode: 'EVENLY',
            paidFor: [
              { participant: participants['Admin'], shares: 1 },
              { participant: participants['Alice'], shares: 1 },
            ],
          },
          {
            id: itemB.id,
            title: 'Item B',
            unitPrice: 7000,
            quantity: 1,
            amount: 7000,
            splitMode: 'EVENLY',
            paidFor: [
              { participant: participants['Admin'], shares: 1 },
              { participant: participants['Bob'], shares: 1 },
            ],
          },
        ],
      },
    })

    const stored = await prisma.expense.findUniqueOrThrow({
      where: { id: expenseId },
      include: { items: true },
    })
    expect(stored.items).toHaveLength(2)
  })

  it('still rejects adding a removed participant that was never on the expense', async () => {
    const { groupId, participants } = await createGroupWithMembers(
      `Issue128-NewRemoved-${runId}`,
      ['Alice', 'Bob'],
    )
    const caller = makeCaller()
    const { expenseId } = await caller.expenses.create({
      requestId: crypto.randomUUID(),
      groupId,
      expense: {
        title: 'Admin only',
        amount: 1000,
        paidByList: [{ participant: participants['Admin'], shares: 1000 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participants['Admin'], shares: 1 }],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        expenseTimeZone: 'UTC',
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    // Bob is removed but was never on this expense.
    await prisma.ledgerParticipant.update({
      where: { id: participants['Bob'] },
      data: { removedAt: new Date() },
    })

    const row = await prisma.expense.findUniqueOrThrow({
      where: { id: expenseId },
      select: { version: true },
    })

    await expect(
      caller.expenses.update({
        expectedVersion: row.version,
        groupId,
        expenseId,
        expense: {
          title: 'Admin only',
          amount: 1000,
          paidByList: [{ participant: participants['Admin'], shares: 1000 }],
          paidBySplitMode: 'BY_AMOUNT',
          isMultiPayer: false,
          paidFor: [
            { participant: participants['Admin'], shares: 1 },
            { participant: participants['Bob'], shares: 1 },
          ],
          category: 'general',
          splitMode: 'EVENLY',
          expenseDate: new Date().toISOString(),
          expenseTimeZone: 'UTC',
          documents: [],
          recurrenceRule: 'NONE',
        },
      }),
    ).rejects.toThrow(/Invalid participant ID/)
  })

  it('settlement update can keep and add removed participants', async () => {
    const { groupId, participants } = await createGroupWithMembers(
      `Issue128-Settlement-${runId}`,
      ['Alice'],
    )
    const caller = makeCaller()
    const { expenseId } = await caller.expenses.create({
      requestId: crypto.randomUUID(),
      groupId,
      expense: {
        title: 'Settle up',
        amount: 5000,
        paidByList: [{ participant: participants['Admin'], shares: 5000 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participants['Alice'], shares: 1 }],
        category: 'settlement',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        expenseTimeZone: 'UTC',
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    await prisma.ledgerParticipant.update({
      where: { id: participants['Alice'] },
      data: { removedAt: new Date() },
    })

    const row = await prisma.expense.findUniqueOrThrow({
      where: { id: expenseId },
      select: { version: true },
    })

    // Rename only — removed Alice stays on the settlement.
    await caller.expenses.update({
      expectedVersion: row.version,
      groupId,
      expenseId,
      expense: {
        title: 'Settle up renamed',
        amount: 5000,
        paidByList: [{ participant: participants['Admin'], shares: 5000 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participants['Alice'], shares: 1 }],
        category: 'settlement',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        expenseTimeZone: 'UTC',
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    const stored = await prisma.expense.findUniqueOrThrow({
      where: { id: expenseId },
    })
    expect(stored.title).toBe('Settle up renamed')
  })

  it('ITEMIZED rename with filler keeps removed participant shares stable', async () => {
    const { groupId, participants } = await createGroupWithMembers(
      `Issue128-Filler-${runId}`,
      ['Alice', 'Bob'],
    )
    const caller = makeCaller()
    const { expenseId } = await caller.expenses.create({
      requestId: crypto.randomUUID(),
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
        expenseTimeZone: 'UTC',
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

    const before = await prisma.expense.findUniqueOrThrow({
      where: { id: expenseId },
      include: { paidFor: true, items: { include: { paidFor: true } } },
    })
    const itemId = before.items[0].id
    const beforeById = Object.fromEntries(
      before.paidFor.map((p) => [p.ledgerParticipantId, p.shares]),
    )

    await prisma.ledgerParticipant.update({
      where: { id: participants['Alice'] },
      data: { removedAt: new Date() },
    })

    const row = await prisma.expense.findUniqueOrThrow({
      where: { id: expenseId },
      select: { version: true },
    })

    await caller.expenses.update({
      expectedVersion: row.version,
      groupId,
      expenseId,
      expense: {
        title: 'Under-sum items renamed',
        amount: 10000,
        paidByList: [{ participant: participants['Admin'], shares: 10000 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participants['Admin'], shares: 1 }],
        category: 'general',
        splitMode: 'ITEMIZED',
        expenseDate: new Date().toISOString(),
        expenseTimeZone: 'UTC',
        documents: [],
        recurrenceRule: 'NONE',
        items: [
          {
            id: itemId,
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

    const after = await prisma.expense.findUniqueOrThrow({
      where: { id: expenseId },
      include: { paidFor: true },
    })
    const afterById = Object.fromEntries(
      after.paidFor.map((p) => [p.ledgerParticipantId, p.shares]),
    )
    // Filler must not migrate away from the removed participant on rename.
    expect(afterById[participants['Alice']]).toBe(
      beforeById[participants['Alice']],
    )
    expect(after.paidFor.reduce((sum, p) => sum + p.shares, 0)).toBe(10000)
  })
})
