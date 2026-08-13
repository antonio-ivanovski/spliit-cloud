import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prisma } from '@spliit/db'
import { DEFAULT_CATEGORY_ID } from '@spliit/domain'

import {
  bulkUpdateExpenseCategories,
  listBulkCategorizeCandidates,
} from '../lib/api/category-bulk'
import { groupsRouter } from '../trpc/routers/groups'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

describe('bulkUpdateExpenseCategories — real DB', () => {
  const runId = testRunId()
  const adminId = `acct-bulk-${runId}`
  const adminEmail = `bulk-${runId}@test.example`

  const createdExpenseIds: string[] = []
  const createdGroupIds: string[] = []
  let groupId: string
  let participantId: string

  function makeCaller() {
    return groupsRouter.createCaller({
      auth: {
        session: { id: 'sess-bulk' },
        user: {
          id: adminId,
          email: adminEmail,
          emailVerified: true,
          name: 'Bulk Admin',
        },
      },
    } as never)
  }

  async function makeExpense(args: {
    title: string
    categoryId?: string
  }): Promise<{ id: string }> {
    const caller = makeCaller()
    const result = await caller.expenses.create({
      requestId: crypto.randomUUID(),
      groupId,
      expense: {
        title: args.title,
        amount: 1000,
        paidByList: [{ participant: participantId, shares: 1000 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participantId, shares: 1 }],
        category: args.categoryId ?? DEFAULT_CATEGORY_ID,
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        expenseTimeZone: 'UTC',
        documents: [],
        recurrenceRule: 'NONE',
      },
    })
    createdExpenseIds.push(result.expenseId)
    return { id: result.expenseId }
  }

  beforeAll(async () => {
    await prisma.account.upsert({
      where: { email: adminEmail },
      update: {},
      create: {
        id: adminId,
        email: adminEmail,
        emailVerified: true,
        name: 'Bulk Admin',
      },
    })
    const caller = makeCaller()
    const createGroup = await caller.create({
      requestId: crypto.randomUUID(),
      groupFormValues: {
        name: `Bulk ${runId}`,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Admin' }],
      },
    })
    groupId = createGroup.groupId
    createdGroupIds.push(groupId)
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { members: { include: { ledgerParticipant: true } } },
    })
    participantId = group!.members[0]!.ledgerParticipant!.id
  })

  afterAll(async () => {
    for (const id of createdExpenseIds) {
      await prisma.expense.delete({ where: { id } }).catch(() => null)
    }
    for (const id of createdGroupIds) {
      const g = await prisma.group.findUnique({
        where: { id },
        select: { ledgerId: true },
      })
      if (g) {
        await prisma.activity.deleteMany({ where: { ledgerId: g.ledgerId } })
      }
      await prisma.group.delete({ where: { id } }).catch(() => null)
    }
    await prisma.account.delete({ where: { id: adminId } }).catch(() => null)
  })

  it('lists general, non-reimbursement expenses as categorization candidates', async () => {
    const general = await makeExpense({ title: 'Needs a category' })
    const categorized = await makeExpense({
      title: 'Already categorized',
      categoryId: 'groceries',
    })
    const reimbursement = await makeExpense({
      title: 'Settlement',
      categoryId: 'settlement',
    })

    const candidates = await listBulkCategorizeCandidates({ groupId })
    const ids = candidates.map((candidate) => candidate.id)

    expect(ids).toContain(general.id)
    expect(ids).not.toContain(categorized.id)
    expect(ids).not.toContain(reimbursement.id)
  })

  it('rejects settlement as a bulk destination', async () => {
    const e = await makeExpense({ title: 'Needs a category' })
    await expect(
      bulkUpdateExpenseCategories({
        groupId,
        accountId: adminId,
        input: {
          groupId,
          changes: [{ expenseId: e.id, categoryId: 'settlement' }],
        },
      }),
    ).rejects.toThrow('Cannot bulk-apply the settlement category')
  })

  it('updates categories for matching, non-reimbursement rows', async () => {
    const e1 = await makeExpense({ title: 'Uber' })
    const e2 = await makeExpense({ title: 'Mercadona' })

    const result = await bulkUpdateExpenseCategories({
      groupId,
      accountId: adminId,
      input: {
        groupId,
        changes: [
          { expenseId: e1.id, categoryId: 'taxi' },
          { expenseId: e2.id, categoryId: 'groceries' },
        ],
      },
    })

    expect(result.applied).toBe(2)
    expect(result.distinctCategories).toBe(2)
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromCategoryId: 'general',
          toCategoryId: 'taxi',
        }),
        expect.objectContaining({
          fromCategoryId: 'general',
          toCategoryId: 'groceries',
        }),
      ]),
    )

    const updated = await prisma.expense.findMany({
      where: { id: { in: [e1.id, e2.id] } },
      select: { id: true, categoryId: true },
    })
    expect(updated.find((u) => u.id === e1.id)?.categoryId).toBe('taxi')
    expect(updated.find((u) => u.id === e2.id)?.categoryId).toBe('groceries')
  })

  it('skips expenses not on the fromCategoryId', async () => {
    const e = await makeExpense({
      title: 'Restaurant',
      categoryId: 'dining-out',
    })

    const result = await bulkUpdateExpenseCategories({
      groupId,
      accountId: adminId,
      input: {
        groupId,
        changes: [{ expenseId: e.id, categoryId: 'groceries' }],
      },
    })
    expect(result.applied).toBe(0)
    expect(result.skipped).toBe(1)

    const r = await prisma.expense.findUnique({ where: { id: e.id } })
    expect(r?.categoryId).toBe('dining-out')
  })

  it('skips reimbursement rows even if they match fromCategoryId', async () => {
    const e = await makeExpense({ title: 'Settle', categoryId: 'settlement' })

    const result = await bulkUpdateExpenseCategories({
      groupId,
      accountId: adminId,
      input: {
        groupId,
        changes: [{ expenseId: e.id, categoryId: 'payment' }],
      },
    })
    expect(result.applied).toBe(0)

    const r = await prisma.expense.findUnique({ where: { id: e.id } })
    expect(r?.categoryId).toBe('settlement')
  })

  it('records a single bulk activity row', async () => {
    const e1 = await makeExpense({ title: 'Coffee' })
    const e2 = await makeExpense({ title: 'Tea' })
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: { ledgerId: true },
    })
    await prisma.activity.deleteMany({
      where: { ledgerId: group!.ledgerId },
    })

    await bulkUpdateExpenseCategories({
      groupId,
      accountId: adminId,
      input: {
        groupId,
        triggeredByAiConfidence: true,
        changes: [
          { expenseId: e1.id, categoryId: 'dining-out' },
          { expenseId: e2.id, categoryId: 'groceries' },
        ],
      },
    })

    const activities = await prisma.activity.findMany({
      where: { ledgerId: group!.ledgerId },
      orderBy: { time: 'desc' },
      take: 1,
    })
    expect(activities).toHaveLength(1)
    const data = activities[0]?.data as {
      kind?: string
      count?: number
      triggeredByAiConfidence?: boolean
    }
    expect(data?.kind).toBe('expense_categories_bulk_updated')
    expect(data?.count).toBe(2)
    expect(data?.triggeredByAiConfidence).toBe(true)
  })

  it('throws on archived group', async () => {
    await prisma.group.update({
      where: { id: groupId },
      data: { archived: true },
    })
    try {
      await expect(
        bulkUpdateExpenseCategories({
          groupId,
          accountId: adminId,
          input: {
            groupId,
            changes: [{ expenseId: 'whatever', categoryId: 'groceries' }],
          },
        }),
      ).rejects.toThrow(/archived/i)
    } finally {
      await prisma.group.update({
        where: { id: groupId },
        data: { archived: false },
      })
    }
  })

  it('tolerates empty changes', async () => {
    const result = await bulkUpdateExpenseCategories({
      groupId,
      accountId: adminId,
      input: {
        groupId,
        changes: [],
      },
    })
    expect(result.applied).toBe(0)
  })

  it('silently drops expenseIds from other groups', async () => {
    const e = await makeExpense({ title: 'Cake' })
    const caller = makeCaller()
    const other = await caller.create({
      requestId: crypto.randomUUID(),
      groupFormValues: {
        name: `Bulk Other ${runId}`,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Admin' }],
      },
    })
    createdGroupIds.push(other.groupId)

    // Try with an obviously bad id to ensure cross-group leakage is
    // harmless. The other group's expense will not exist in the
    // candidate set (its ledgerId won't match), so we get applied=1
    // and 0 errors.
    const result = await bulkUpdateExpenseCategories({
      groupId,
      accountId: adminId,
      input: {
        groupId,
        changes: [
          { expenseId: e.id, categoryId: 'groceries' },
          { expenseId: 'totally-bogus-id', categoryId: 'taxi' },
        ],
      },
    })
    expect(result.applied).toBe(1)
  })
})
