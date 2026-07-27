import { prisma } from '@spliit/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { groupsRouter } from '../trpc/routers/groups'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

describe('Expense comments — real DB', () => {
  const runId = testRunId()
  const accountId = `acct-comment-${runId}`
  const email = `comment-${runId}@test.example`
  let ledgerId: string | undefined

  const caller = groupsRouter.createCaller({
    auth: {
      session: { id: `session-${runId}` },
      user: {
        id: accountId,
        email,
        emailVerified: true,
        name: 'Comment Author',
      },
    },
  } as never)

  beforeAll(async () => {
    await prisma.account.create({
      data: {
        id: accountId,
        email,
        emailVerified: true,
        name: 'Comment Author',
      },
    })
  })

  afterAll(async () => {
    if (ledgerId) {
      await prisma.ledger.delete({ where: { id: ledgerId } }).catch(() => {})
    }
    await prisma.account.delete({ where: { id: accountId } }).catch(() => {})
  })

  it('preserves author snapshots and cascades comment activities with the expense', async () => {
    const { groupId } = await caller.create({
      groupFormValues: {
        name: `Comments ${runId}`,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Comment Author' }],
      },
    })
    const group = await prisma.group.findUniqueOrThrow({
      where: { id: groupId },
      include: {
        members: { include: { ledgerParticipant: true } },
      },
    })
    ledgerId = group.ledgerId
    const participantId = group.members[0]?.ledgerParticipant?.id
    expect(participantId).toBeTruthy()

    const { expenseId } = await caller.expenses.create({
      groupId,
      expense: {
        title: 'Dinner',
        amount: 2500,
        paidByList: [{ participant: participantId!, shares: 2500 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participantId!, shares: 1 }],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })
    const { comment } = await caller.expenses.comments.create({
      groupId,
      expenseId,
      body: '  Keep the receipt.  ',
    })

    expect(comment).toMatchObject({
      body: 'Keep the receipt.',
      author: { accountId, name: 'Comment Author' },
      canDelete: true,
    })
    const activity = await prisma.activity.findUnique({
      where: { expenseCommentId: comment.id },
    })
    expect(activity).toMatchObject({
      type: 'EXPENSE_COMMENTED',
      subjectType: 'EXPENSE',
      subjectId: expenseId,
    })

    await prisma.account.delete({ where: { id: accountId } })
    const preserved = await prisma.expenseComment.findUniqueOrThrow({
      where: { id: comment.id },
    })
    expect(preserved).toMatchObject({
      authorAccountId: null,
      authorName: 'Comment Author',
      text: 'Keep the receipt.',
    })

    await prisma.expense.delete({ where: { id: expenseId } })
    await expect(
      prisma.expenseComment.findUnique({ where: { id: comment.id } }),
    ).resolves.toBeNull()
    await expect(
      prisma.activity.findUnique({ where: { id: activity!.id } }),
    ).resolves.toBeNull()
  })
})
