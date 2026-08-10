import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { GroupMemberStatus, GroupRole, prisma } from '@spliit/db'

import { randomId } from '../lib/api'
import { groupsRouter } from '../trpc/routers/groups'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

describe('large group imports', () => {
  const runId = testRunId()
  const accountId = `large-import-account-${runId}`
  const email = `large-import-${runId}@example.test`
  const ledgerIds: string[] = []

  function makeCaller() {
    return groupsRouter.createCaller({
      auth: {
        session: { id: `session-${runId}` },
        user: {
          id: accountId,
          email,
          emailVerified: true,
          name: 'Large Import Admin',
        },
      },
    } as never)
  }

  async function createTargetGroup() {
    const ledgerId = randomId()
    const groupId = randomId()
    const firstParticipantId = randomId()
    const secondParticipantId = randomId()
    ledgerIds.push(ledgerId)

    await prisma.ledger.create({
      data: { id: ledgerId, currency: '$', currencyCode: 'USD' },
    })
    await prisma.group.create({
      data: { id: groupId, name: `Large Import ${runId}`, ledgerId },
    })
    await prisma.groupMember.create({
      data: {
        id: randomId(),
        groupId,
        accountId,
        role: GroupRole.ADMIN,
        status: GroupMemberStatus.ACTIVE,
        joinedAt: new Date(),
      },
    })
    await prisma.ledgerParticipant.createMany({
      data: [
        {
          id: firstParticipantId,
          ledgerId,
          kind: 'UNLINKED_PARTICIPANT',
          displayName: 'Alice',
        },
        {
          id: secondParticipantId,
          ledgerId,
          kind: 'UNLINKED_PARTICIPANT',
          displayName: 'Bob',
        },
      ],
    })

    return { groupId, ledgerId, firstParticipantId, secondParticipantId }
  }

  function buildExpenses(
    count: number,
    firstParticipantId: string,
    secondParticipantId: string,
    invalidIndex?: number,
  ) {
    return Array.from({ length: count }, (_, index) => ({
      expenseDate: new Date('2026-08-01'),
      title: `Imported expense ${index}`,
      category: 'general' as const,
      amount: index === invalidIndex ? 2_147_483_648 : 1000 + index,
      paidBySplitMode: 'BY_AMOUNT' as const,
      paidByList: [{ participant: firstParticipantId, shares: 1000 + index }],
      paidFor: [
        { participant: firstParticipantId, shares: 500 },
        { participant: secondParticipantId, shares: 500 + index },
      ],
      splitMode: 'BY_AMOUNT' as const,
      isReimbursement: false,
      documents: [
        {
          id: `receipt-${runId}-${index}`,
          url: `https://example.test/receipt-${runId}-${index}.jpg`,
          width: 640,
          height: 480,
        },
      ],
      recurrenceRule: 'NONE' as const,
    }))
  }

  function buildParticipants(
    firstParticipantId: string,
    secondParticipantId: string,
  ) {
    return [
      {
        mode: 'LINK_EXISTING_PARTICIPANT' as const,
        sourceName: 'Alice',
        destLedgerParticipantId: firstParticipantId,
      },
      {
        mode: 'LINK_EXISTING_PARTICIPANT' as const,
        sourceName: 'Bob',
        destLedgerParticipantId: secondParticipantId,
      },
    ]
  }

  beforeAll(async () => {
    await prisma.account.create({
      data: {
        id: accountId,
        email,
        emailVerified: true,
        name: 'Large Import Admin',
      },
    })
  })

  afterAll(async () => {
    for (const ledgerId of ledgerIds) {
      await prisma.ledger.delete({ where: { id: ledgerId } }).catch(() => {})
    }
    await prisma.account.delete({ where: { id: accountId } }).catch(() => {})
  })

  it('imports 1,113 expenses and all dependent rows within the default transaction timeout', async () => {
    const target = await createTargetGroup()
    const result = await makeCaller().import({
      targetGroupId: target.groupId,
      participants: buildParticipants(
        target.firstParticipantId,
        target.secondParticipantId,
      ),
      expenses: buildExpenses(
        1113,
        target.firstParticipantId,
        target.secondParticipantId,
      ),
      sourceMeta: {
        provider: 'SPLIIT',
        sourceGroupId: `source-${runId}`,
      },
    })

    expect(result.importedExpenses).toBe(1113)
    await expect(
      prisma.expense.count({ where: { ledgerId: target.ledgerId } }),
    ).resolves.toBe(1113)
    await expect(
      prisma.expensePaidBy.count({
        where: { expense: { ledgerId: target.ledgerId } },
      }),
    ).resolves.toBe(1113)
    await expect(
      prisma.expensePaidFor.count({
        where: { expense: { ledgerId: target.ledgerId } },
      }),
    ).resolves.toBe(2226)
    await expect(
      prisma.expenseDocument.count({
        where: { ledgerId: target.ledgerId },
      }),
    ).resolves.toBe(1113)
    await expect(
      prisma.activity.count({
        where: { ledgerId: target.ledgerId, type: 'EXPENSE_CREATED' },
      }),
    ).resolves.toBe(1113)
    await expect(
      prisma.activity.count({
        where: { ledgerId: target.ledgerId, type: 'EXPENSES_IMPORTED' },
      }),
    ).resolves.toBe(1)
  }, 20_000)

  it('rolls back a later failed batch and permits a clean retry', async () => {
    const target = await createTargetGroup()
    const participants = buildParticipants(
      target.firstParticipantId,
      target.secondParticipantId,
    )

    await expect(
      makeCaller().import({
        targetGroupId: target.groupId,
        participants,
        expenses: buildExpenses(
          1001,
          target.firstParticipantId,
          target.secondParticipantId,
          1000,
        ),
      }),
    ).rejects.toThrow()

    await expect(
      prisma.expense.count({ where: { ledgerId: target.ledgerId } }),
    ).resolves.toBe(0)
    await expect(
      prisma.activity.count({ where: { ledgerId: target.ledgerId } }),
    ).resolves.toBe(0)

    const retry = await makeCaller().import({
      targetGroupId: target.groupId,
      participants,
      expenses: buildExpenses(
        1001,
        target.firstParticipantId,
        target.secondParticipantId,
      ),
    })
    expect(retry.importedExpenses).toBe(1001)
    await expect(
      prisma.expense.count({ where: { ledgerId: target.ledgerId } }),
    ).resolves.toBe(1001)
  }, 20_000)
})
