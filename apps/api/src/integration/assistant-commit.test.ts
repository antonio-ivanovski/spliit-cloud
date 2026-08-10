import { afterAll, describe, expect, it } from 'vitest'

import { prisma } from '@spliit/db'

import { prepareAssistantExpense } from '../lib/assistant/expense'
import { assistantRouter } from '../trpc/routers/assistant'
import { groupsRouter } from '../trpc/routers/groups'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

describe('assistant expense confirmation concurrency', () => {
  const runId = testRunId()
  const accountId = `acct-commit-${runId}`
  const email = `commit-${runId}@test.example`
  let groupId = ''
  let ledgerId = ''

  afterAll(async () => {
    if (ledgerId) {
      await prisma.expense.deleteMany({ where: { ledgerId } }).catch(() => {})
      await prisma.ledger.delete({ where: { id: ledgerId } }).catch(() => {})
    }
    await prisma.account.delete({ where: { id: accountId } }).catch(() => {})
  })

  it('commits exactly one expense, activity, and notification sequence for parallel confirmations', async () => {
    await prisma.account.create({
      data: {
        id: accountId,
        email,
        emailVerified: true,
        name: 'Commit Racer',
      },
    })

    const groupCaller = groupsRouter.createCaller({
      auth: {
        session: { id: `sess-${runId}` },
        user: {
          id: accountId,
          email,
          emailVerified: true,
          name: 'Commit Racer',
        },
      },
    } as never)
    const created = await groupCaller.create({
      requestId: crypto.randomUUID(),
      groupFormValues: {
        name: `Commit Group ${runId}`,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Commit Racer' }, { name: 'Roommate' }],
      },
    })
    groupId = created.groupId
    const group = await prisma.group.findUniqueOrThrow({
      where: { id: groupId },
      select: { ledgerId: true },
    })
    ledgerId = group.ledgerId

    const prepared = await prepareAssistantExpense(
      { groupId, amount: '24.00', title: 'Concurrent groceries' },
      accountId,
    )

    const assistantCaller = assistantRouter.createCaller({
      auth: {
        credentialKind: 'oauth',
        accessToken: 'test-token',
        scopes: ['spliit:groups:read', 'spliit:expenses:write'],
        user: await prisma.account.findUniqueOrThrow({
          where: { id: accountId },
        }),
        session: { id: `oauth:${accountId}` },
      },
    } as never)

    const [first, second] = await Promise.all([
      assistantCaller.createExpense({
        confirmationToken: prepared.confirmationToken,
      }),
      assistantCaller.createExpense({
        confirmationToken: prepared.confirmationToken,
      }),
    ])

    // Both calls converge on the same expense; exactly one performs the create.
    expect(first.expenseId).toBe(second.expenseId)
    expect(first.alreadyCreated).not.toBe(second.alreadyCreated)

    const expenses = await prisma.expense.findMany({
      where: { assistantRequestId: prepared.requestId },
    })
    expect(expenses).toHaveLength(1)
    expect(expenses[0].id).toBe(first.expenseId)

    const creationActivities = await prisma.activity.findMany({
      where: {
        ledgerId,
        type: 'EXPENSE_CREATED',
        subjectType: 'EXPENSE',
        subjectId: first.expenseId,
      },
    })
    expect(creationActivities).toHaveLength(1)

    // A single planned notification sequence: every delivery for this ledger
    // references the one creation activity, never a duplicate.
    const deliveries = await prisma.notificationDelivery.findMany({
      where: { activity: { ledgerId } },
      select: { activityId: true },
    })
    const referencedActivityIds = new Set(
      deliveries.map((delivery) => delivery.activityId),
    )
    expect(referencedActivityIds.size).toBeLessThanOrEqual(1)
    if (referencedActivityIds.size === 1) {
      expect(referencedActivityIds.has(creationActivities[0].id)).toBe(true)
    }
  })
})
