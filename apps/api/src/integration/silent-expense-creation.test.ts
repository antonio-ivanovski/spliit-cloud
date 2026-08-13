import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { GroupMemberStatus, GroupRole, prisma } from '@spliit/db'

import { randomId } from '../lib/api'
import {
  setDefaultActivityNotificationDispatchers,
  waitForScheduledNotificationDispatchesForTest,
} from '../lib/notifications/dispatcher'
import { groupsRouter } from '../trpc/routers/groups'
import {
  CapturingDispatcher,
  checkDbConnection,
  initializeTestAccountTimeZone,
  testRunId,
} from './setup'

await checkDbConnection()

describe('Silent expense creation — activity + notification', () => {
  const runId = testRunId()
  const adminId = `acct-sec-${runId}`
  const adminEmail = `sec-${runId}@test.example`
  const aliceId = `acct-sec-a-${runId}`
  const aliceEmail = `sec-a-${runId}@test.example`

  const ledgerIds: string[] = []
  function trackLedger(id: string) {
    ledgerIds.push(id)
  }

  let capture: CapturingDispatcher

  function makeCaller(accountId = adminId, email = adminEmail) {
    return groupsRouter.createCaller({
      auth: {
        session: { id: 'sess-test' },
        user: {
          id: accountId,
          email,
          emailVerified: true,
          name: accountId === adminId ? 'Test Admin' : 'Alice',
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
    await prisma.account.upsert({
      where: { email: aliceEmail },
      update: {},
      create: {
        id: aliceId,
        email: aliceEmail,
        emailVerified: true,
        name: 'Alice',
      },
    })
    await initializeTestAccountTimeZone(adminId)
  })

  afterEach(async () => {
    try {
      await waitForScheduledNotificationDispatchesForTest()
    } finally {
      setDefaultActivityNotificationDispatchers([])
    }
  })

  afterAll(async () => {
    setDefaultActivityNotificationDispatchers([])
    for (const lid of ledgerIds) {
      await prisma.ledger.delete({ where: { id: lid } }).catch(() => {})
    }
    await prisma.account.delete({ where: { id: adminId } }).catch(() => {})
    await prisma.account.delete({ where: { id: aliceId } }).catch(() => {})
  })

  // -------------------------------------------------------------------
  // Helper: create a group with admin + optional Alice member
  // -------------------------------------------------------------------
  async function createGroup(name: string, addAlice = false) {
    capture = new CapturingDispatcher()
    setDefaultActivityNotificationDispatchers([capture])

    const caller = makeCaller()
    const result = await caller.create({
      requestId: crypto.randomUUID(),
      groupFormValues: {
        name,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Admin' }],
      },
    })
    const group = await prisma.group.findUnique({
      where: { id: result.groupId },
      include: {
        ledger: true,
        members: { include: { ledgerParticipant: true } },
      },
    })
    trackLedger(group!.ledger.id)
    const adminLp = group!.members[0].ledgerParticipant!.id

    let aliceLp: string | undefined
    if (addAlice) {
      const am = await prisma.groupMember.create({
        data: {
          id: randomId(),
          groupId: result.groupId,
          accountId: aliceId,
          role: GroupRole.MEMBER,
          status: GroupMemberStatus.ACTIVE,
          joinedAt: new Date(),
        },
      })
      aliceLp = (
        await prisma.ledgerParticipant.create({
          data: {
            id: randomId(),
            ledgerId: group!.ledger.id,
            groupMemberId: am.id,
          },
        })
      ).id
    }

    return {
      groupId: result.groupId,
      ledgerId: group!.ledger.id,
      adminLp,
      aliceLp,
    }
  }

  function utcDateOffset(days: number) {
    const now = new Date()
    return new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + days,
      ),
    )
  }

  async function createDailyRecurringSeries(
    groupId: string,
    ledgerId: string,
    adminLp: string,
    title: string,
    anchorDate: Date,
  ) {
    await makeCaller().expenses.create({
      requestId: crypto.randomUUID(),
      groupId,
      expense: {
        title,
        amount: 1000,
        expenseDate: anchorDate.toISOString(),
        expenseTimeZone: 'UTC',
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [{ participant: adminLp, shares: 1000 }],
        paidFor: [{ participant: adminLp, shares: 1 }],
        documents: [],
        recurrenceRule: 'DAILY',
      },
    })
    return prisma.recurringExpenseSeries.findFirstOrThrow({
      where: { ledgerId, template: { path: ['title'], equals: title } },
    })
  }

  // -------------------------------------------------------------------
  // 1. Archive with force=true — one activity + notification per leg
  // -------------------------------------------------------------------
  it('archive force=true writes activity + notification per settlement leg', async () => {
    const { groupId, adminLp, aliceLp } = await createGroup(
      `Arc-Act-${runId}`,
      true,
    )

    // Admin paid $40 for both → Alice owes Admin $20
    const expenseDate = new Date()
    await makeCaller().expenses.create({
      requestId: crypto.randomUUID(),
      groupId,
      expense: {
        title: 'Dinner',
        amount: 4000,
        expenseDate: expenseDate.toISOString(),
        expenseTimeZone: 'UTC',
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [{ participant: adminLp, shares: 4000 }],
        paidFor: [
          { participant: adminLp, shares: 1 },
          { participant: aliceLp!, shares: 1 },
        ],
        documents: [],
        recurrenceRule: 'NONE',
      },
    })
    capture.events.length = 0

    await makeCaller().archive({ groupId, archived: true, force: true })

    const settlements = await prisma.expense.findMany({
      where: { ledger: { group: { id: groupId } }, categoryId: 'settlement' },
    })

    for (const s of settlements) {
      const activity = await prisma.activity.findFirst({
        where: { subjectId: s.id, type: 'EXPENSE_CREATED' },
      })
      expect(activity).not.toBeNull()
      const data = activity!.data as Record<string, unknown>
      expect(data.kind).toBe('expense')
      expect(data.title).toBe('Settlement on archive')
      expect(data.amount).toBe(s.amount)
      expect(data.currencyCode).toBe('USD')
      expect(data.date).toBe(s.expenseDate.toISOString().slice(0, 10))
    }

    await waitForScheduledNotificationDispatchesForTest()
    const settlementEvents = capture.events.filter(
      (e) => e.type === 'EXPENSE_CREATED',
    )
    expect(settlementEvents.length).toBeGreaterThanOrEqual(settlements.length)
  })

  // -------------------------------------------------------------------
  // 2. Leave with force=true — activity + notification for the member's leg
  // -------------------------------------------------------------------
  it('leave force=true writes activity + notification for leaving member leg', async () => {
    const { groupId, ledgerId, adminLp, aliceLp } = await createGroup(
      `Leave-Act-${runId}`,
      true,
    )

    // Find Alice's member record for potential promotion
    const aliceMember = await prisma.groupMember.findFirst({
      where: { groupId, accountId: aliceId },
    })

    // Admin paid $40, split evenly → Alice owes Admin $20
    const expenseDate = new Date()
    await makeCaller().expenses.create({
      requestId: crypto.randomUUID(),
      groupId,
      expense: {
        title: 'Lunch',
        amount: 4000,
        expenseDate: expenseDate.toISOString(),
        expenseTimeZone: 'UTC',
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [{ participant: adminLp, shares: 4000 }],
        paidFor: [
          { participant: adminLp, shares: 1 },
          { participant: aliceLp!, shares: 1 },
        ],
        documents: [],
        recurrenceRule: 'NONE',
      },
    })
    capture.events.length = 0

    // Admin leaves with force=true → settlement expense for admin's leg.
    // Promote Alice first since Admin is the last admin.
    await makeCaller(adminId).leave({
      groupId,
      force: true,
      promoteMemberId: aliceMember!.id,
    })

    // Also check if the member was marked as LEFT
    const adminMemberAfter = await prisma.groupMember.findFirst({
      where: { groupId, accountId: adminId },
    })
    expect(adminMemberAfter?.status).toBe('LEFT')

    const settlements = await prisma.expense.findMany({
      where: { ledgerId, categoryId: 'settlement' },
    })
    // Should have at least one settlement expense
    expect(settlements.length).toBeGreaterThanOrEqual(1)

    for (const s of settlements) {
      const activity = await prisma.activity.findFirst({
        where: { subjectId: s.id, type: 'EXPENSE_CREATED' },
      })
      expect(activity).not.toBeNull()
      const data = activity!.data as Record<string, unknown>
      expect(data.kind).toBe('expense')
      expect(data.title).toBe('Settlement on leave')
      expect(data.amount).toBe(s.amount)
      expect(data.currencyCode).toBe('USD')
    }

    await waitForScheduledNotificationDispatchesForTest()
    const settlementEvents = capture.events.filter(
      (e) => e.type === 'EXPENSE_CREATED',
    )
    expect(settlementEvents.length).toBeGreaterThanOrEqual(settlements.length)
  })

  // -------------------------------------------------------------------
  // 3. Recurring expense — activity per installment. Notification dispatch is
  // owned by the background worker and is covered by its unit test.
  // -------------------------------------------------------------------
  it('recurring expense materialization writes a recurring activity', async () => {
    const { groupId, ledgerId, adminLp } = await createGroup(
      `Recur-Act-${runId}`,
      false,
    )

    // Create a WEEKLY expense in the past
    const pastDate = new Date()
    pastDate.setUTCDate(pastDate.getUTCDate() - 14)

    await makeCaller().expenses.create({
      requestId: crypto.randomUUID(),
      groupId,
      expense: {
        title: 'Weekly sub',
        amount: 1000,
        expenseDate: pastDate.toISOString(),
        expenseTimeZone: 'UTC',
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [{ participant: adminLp, shares: 1000 }],
        paidFor: [{ participant: adminLp, shares: 1 }],
        documents: [],
        recurrenceRule: 'WEEKLY',
      },
    })
    capture.events.length = 0

    const { materializeRecurringExpense } =
      await import('../lib/api/recurrence-series')
    let series = await prisma.recurringExpenseSeries.findFirst({
      where: { ledgerId, template: { path: ['title'], equals: 'Weekly sub' } },
    })
    while (series && series.nextOccurrenceDate <= new Date()) {
      await materializeRecurringExpense({
        seriesId: series.id,
        sequence: series.occurrencesCreated + 1,
        occurrenceDate: series.nextOccurrenceDate.toISOString().slice(0, 10),
      })
      series = await prisma.recurringExpenseSeries.findUnique({
        where: { id: series.id },
      })
    }

    const cloned = await prisma.expense.findMany({
      where: { ledgerId, title: 'Weekly sub' },
      orderBy: { createdAt: 'asc' },
    })
    // Original + at least one clone
    expect(cloned.length).toBeGreaterThanOrEqual(2)

    const installments = cloned.slice(1)
    for (const inst of installments) {
      const activity = await prisma.activity.findFirst({
        where: { subjectId: inst.id, type: 'RECURRING_EXPENSE_CREATED' },
      })
      expect(activity).not.toBeNull()
      const data = activity!.data as Record<string, unknown>
      expect(data.kind).toBe('expense')
      expect(data.title).toBe('Weekly sub')
      expect(data.amount).toBe(1000)
      expect(data.currencyCode).toBeNull()
      expect(data.ledgerCurrencyCode).toBe('USD')
    }

    expect(installments.length).toBeGreaterThanOrEqual(2)
    await makeCaller().expenses.update({
      expectedVersion: (
        await prisma.expense.findUniqueOrThrow({
          where: { id: installments[0]!.id },
          select: { version: true },
        })
      ).version,
      groupId,
      expenseId: installments[0]!.id,
      scope: 'THIS_AND_FUTURE',
      expense: {
        title: 'Updated weekly sub',
        amount: 1200,
        expenseDate: installments[0]!.expenseDate.toISOString(),
        expenseTimeZone: installments[0]!.expenseTimeZone,
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [{ participant: adminLp, shares: 1200 }],
        paidFor: [{ participant: adminLp, shares: 1 }],
        documents: [],
        recurrenceRule: 'WEEKLY',
        recurrence: {
          frequency: 'WEEKLY',
          interval: 1,
          end: { type: 'INDEFINITE' },
        },
      },
    })
    const propagated = await prisma.expense.findUniqueOrThrow({
      where: { id: installments[1]!.id },
      include: { documents: true },
    })
    expect(propagated.title).toBe('Updated weekly sub')
    expect(propagated.amount).toBe(1200)
    expect(propagated.expenseDate).toEqual(installments[1]!.expenseDate)
    expect(propagated.documents).toEqual([])
  })

  it('persists the opening UTC cutoff for a catch-up batch', async () => {
    const { groupId, ledgerId, adminLp } = await createGroup(
      `Recur-Cutoff-Open-${runId}`,
    )
    const anchorDate = utcDateOffset(-3)
    const series = await createDailyRecurringSeries(
      groupId,
      ledgerId,
      adminLp,
      'Daily cutoff open',
      anchorDate,
    )
    await prisma.recurringExpenseSeries.update({
      where: { id: series.id },
      data: { catchUpBatch: null },
    })

    const { materializeRecurringExpense } =
      await import('../lib/api/recurrence-series')
    await materializeRecurringExpense({
      seriesId: series.id,
      sequence: series.occurrencesCreated + 1,
      occurrenceDate: series.nextOccurrenceDate.toISOString().slice(0, 10),
    })

    const updated = await prisma.recurringExpenseSeries.findUniqueOrThrow({
      where: { id: series.id },
    })
    expect(updated.catchUpBatch).toMatchObject({
      startDate: series.nextOccurrenceDate.toISOString().slice(0, 10),
      count: 1,
      dueThrough: utcDateOffset(0).toISOString().slice(0, 10),
    })
  })

  it('finalizes a catch-up batch at its persisted cutoff', async () => {
    const { groupId, ledgerId, adminLp } = await createGroup(
      `Recur-Cutoff-Finalize-${runId}`,
    )
    const anchorDate = utcDateOffset(-2)
    const series = await createDailyRecurringSeries(
      groupId,
      ledgerId,
      adminLp,
      'Daily cutoff finalize',
      anchorDate,
    )
    const occurrenceDate = series.nextOccurrenceDate.toISOString().slice(0, 10)
    await prisma.recurringExpenseSeries.update({
      where: { id: series.id },
      data: {
        catchUpBatch: {
          id: `recurring-catchup:${series.id}:${anchorDate.toISOString().slice(0, 10)}`,
          startDate: anchorDate.toISOString().slice(0, 10),
          count: 1,
          dueThrough: occurrenceDate,
        },
      },
    })

    const { materializeRecurringExpense } =
      await import('../lib/api/recurrence-series')
    const result = await materializeRecurringExpense({
      seriesId: series.id,
      sequence: series.occurrencesCreated + 1,
      occurrenceDate,
    })

    const updated = await prisma.recurringExpenseSeries.findUniqueOrThrow({
      where: { id: series.id },
    })
    expect(updated.nextOccurrenceDate.toISOString().slice(0, 10)).toBe(
      utcDateOffset(0).toISOString().slice(0, 10),
    )
    expect(updated.catchUpBatch).toBeNull()
    expect(result.catchUpSummary).toMatchObject({
      count: 2,
      startDate: anchorDate.toISOString().slice(0, 10),
      endDate: occurrenceDate,
    })
  })
})
