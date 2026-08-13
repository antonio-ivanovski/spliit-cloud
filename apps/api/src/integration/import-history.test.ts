import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prisma } from '@spliit/db'

import { randomId } from '../lib/api'
import { groupsRouter } from '../trpc/routers/groups'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

describe('Spliit import history', () => {
  const runId = testRunId()
  const accountId = `import-history-${runId}`
  const accountEmail = `${accountId}@test.example`
  const ledgerIds: string[] = []

  function caller() {
    return groupsRouter.createCaller({
      auth: {
        session: { id: `session-${runId}` },
        user: {
          id: accountId,
          email: accountEmail,
          emailVerified: true,
          name: 'History Importer',
        },
      },
    } as never)
  }

  beforeAll(async () => {
    await prisma.account.create({
      data: {
        id: accountId,
        email: accountEmail,
        emailVerified: true,
        name: 'History Importer',
      },
    })
  })

  afterAll(async () => {
    for (const ledgerId of ledgerIds) {
      await prisma.ledger.delete({ where: { id: ledgerId } }).catch(() => {})
    }
    await prisma.account.delete({ where: { id: accountId } }).catch(() => {})
  })

  it('restores history for new and existing-group imports without notifications', async () => {
    const firstParticipantId = randomId()
    const createdAt = new Date('2025-11-15T01:00:00.000Z')
    const deletedAt = new Date('2025-11-16T01:00:00.000Z')
    const created = await caller().import({
      requestId: crypto.randomUUID(),
      groupFormValues: {
        name: `History ${runId}`,
        information: 'Imported information',
        currency: '€',
        currencyCode: 'EUR',
        participants: [{ name: 'Owner' }],
      },
      participants: [
        {
          mode: 'LINK_ACCOUNT',
          sourceName: 'History Importer',
          linkedAccountId: accountId,
          destLedgerParticipantId: firstParticipantId,
        },
      ],
      expenses: [
        {
          title: 'Imported dinner',
          amount: 2400,
          expenseDate: new Date('2025-11-15'),
          category: 'general',
          splitMode: 'EVENLY',
          paidBySplitMode: 'BY_AMOUNT',
          paidByList: [{ participant: firstParticipantId, shares: 2400 }],
          paidFor: [{ participant: firstParticipantId, shares: 1 }],
          documents: [],
          recurrenceRule: 'NONE',
        },
      ],
      sourceMeta: { provider: 'SPLIIT', sourceGroupId: `source-${runId}` },
      historicalActivities: [
        {
          time: createdAt,
          activityType: 'CREATE_EXPENSE',
          actorParticipantId: firstParticipantId,
          expenseIndex: 0,
          data: 'Imported dinner',
        },
        {
          time: deletedAt,
          activityType: 'DELETE_EXPENSE',
          actorParticipantId: null,
          expenseIndex: null,
          data: 'Old dinner',
        },
      ],
    })

    const group = await prisma.group.findUniqueOrThrow({
      where: { id: created.groupId },
      select: { information: true, ledgerId: true },
    })
    ledgerIds.push(group.ledgerId!)
    expect(group.information).toBe('Imported information')

    const restored = await prisma.activity.findMany({
      where: {
        ledgerId: group.ledgerId!,
        time: { in: [createdAt, deletedAt] },
      },
      orderBy: { time: 'asc' },
    })
    expect(restored).toHaveLength(2)
    expect(restored[0]).toMatchObject({
      type: 'EXPENSE_CREATED',
      actorType: 'LEDGER_PARTICIPANT',
      actorId: firstParticipantId,
      subjectType: 'EXPENSE',
    })
    expect(restored[0]!.subjectId).toBeTruthy()
    expect(restored[1]).toMatchObject({
      type: 'EXPENSE_DELETED',
      actorType: null,
      subjectType: null,
      subjectId: null,
    })
    expect(
      await prisma.activity.count({
        where: { ledgerId: group.ledgerId!, type: 'EXPENSE_CREATED' },
      }),
    ).toBe(1)
    expect(
      await prisma.notificationDelivery.count({
        where: { activityId: { in: restored.map((activity) => activity.id) } },
      }),
    ).toBe(0)

    const mergedAt = new Date('2025-12-01T09:30:00.000Z')
    await caller().import({
      requestId: crypto.randomUUID(),
      targetGroupId: created.groupId,
      participants: [
        {
          mode: 'LINK_EXISTING_PARTICIPANT',
          sourceName: 'History Importer',
          destLedgerParticipantId: firstParticipantId,
        },
      ],
      expenses: [],
      sourceMeta: {
        provider: 'SPLIIT',
        sourceGroupId: `merge-source-${runId}`,
      },
      historicalActivities: [
        {
          time: mergedAt,
          activityType: 'UPDATE_GROUP',
          actorParticipantId: firstParticipantId,
          expenseIndex: null,
          data: null,
        },
      ],
    })

    const merged = await prisma.activity.findFirstOrThrow({
      where: { ledgerId: group.ledgerId!, time: mergedAt },
    })
    expect(merged).toMatchObject({
      type: 'GROUP_UPDATED',
      actorType: 'LEDGER_PARTICIPANT',
      actorId: firstParticipantId,
      subjectType: 'GROUP',
      subjectId: created.groupId,
    })
    expect(
      await prisma.notificationDelivery.count({
        where: { activityId: merged.id },
      }),
    ).toBe(0)
  })
})
