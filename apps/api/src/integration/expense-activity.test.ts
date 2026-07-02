import { prisma, GroupMemberStatus, GroupRole } from '@spliit/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { groupsRouter } from '../trpc/routers/groups'
import { checkDbConnection, testRunId } from './setup'
import {
  setDefaultActivityNotificationDispatchers,
  type ActivityNotificationDispatcher,
  type ActivityNotificationEvent,
} from '../lib/notifications/dispatcher'

await checkDbConnection()

class CapturingDispatcher implements ActivityNotificationDispatcher {
  events: ActivityNotificationEvent[] = []
  async dispatch(event: ActivityNotificationEvent): Promise<void> {
    this.events.push(event)
  }
}

describe('Expense activity — real DB', () => {
  const runId = testRunId()
  const adminId = `acct-ea-${runId}`
  const adminEmail = `ea-${runId}@test.example`
  const recipientId = `acct-ea-r-${runId}`
  const recipientEmail = `ea-r-${runId}@test.example`

  const ledgerIds: string[] = []
  function trackLedger(id: string) {
    ledgerIds.push(id)
  }

  let groupId: string
  let adminParticipantId: string
  let recipientParticipantId: string
  let expenseId: string
  let capture: CapturingDispatcher

  function makeCaller(overrides?: { accountId?: string; email?: string }) {
    return groupsRouter.createCaller({
      auth: {
        session: { id: 'sess-test' },
        user: {
          id: overrides?.accountId ?? adminId,
          email: overrides?.email ?? adminEmail,
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
    await prisma.account.upsert({
      where: { email: recipientEmail },
      update: {},
      create: {
        id: recipientId,
        email: recipientEmail,
        emailVerified: true,
        name: 'Test Recipient',
      },
    })

    // Create group
    const caller = makeCaller()
    const result = await caller.create({
      groupFormValues: {
        name: `Expense Activity ${runId}`,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Admin' }],
      },
    })
    groupId = result.groupId
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        ledger: true,
        members: { include: { ledgerParticipant: true } },
      },
    })
    trackLedger(group!.ledger.id)
    adminParticipantId = group!.members[0].ledgerParticipant!.id

    // Add recipient member via DB
    const recipientMemberId = `gm-ea-r-${runId}`
    recipientParticipantId = `lp-ea-r-${runId}`
    await prisma.groupMember.create({
      data: {
        id: recipientMemberId,
        groupId,
        accountId: recipientId,
        role: GroupRole.MEMBER,
        status: GroupMemberStatus.ACTIVE,
        joinedAt: new Date(),
      },
    })
    await prisma.ledgerParticipant.create({
      data: {
        id: recipientParticipantId,
        ledgerId: group!.ledger.id,
        groupMemberId: recipientMemberId,
      },
    })
  })

  afterAll(async () => {
    setDefaultActivityNotificationDispatchers([])
    for (const lid of ledgerIds) {
      await prisma.ledger.delete({ where: { id: lid } }).catch(() => {})
    }
    await prisma.account.delete({ where: { id: adminId } }).catch(() => {})
    await prisma.account.delete({ where: { id: recipientId } }).catch(() => {})
  })

  // ------------------------------------------------------------------------
  // 1. Create expense — assert activity row + dispatcher event
  // ------------------------------------------------------------------------
  it('logs EXPENSE_CREATED and dispatches for the created expense', async () => {
    capture = new CapturingDispatcher()
    setDefaultActivityNotificationDispatchers([capture])

    const caller = makeCaller()
    const result = await caller.expenses.create({
      groupId,
      expense: {
        title: 'Test Dinner',
        amount: 3000,
        paidByList: [
          { participant: adminParticipantId, shares: 1500 },
          { participant: recipientParticipantId, shares: 1500 },
        ],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: true,
        paidFor: [
          { participant: adminParticipantId, shares: 1 },
          { participant: recipientParticipantId, shares: 1 },
        ],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date('2026-07-02').toISOString(),
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })
    expenseId = result.expenseId

    // Assert activity row
    const activity = await prisma.activity.findFirst({
      where: { subjectId: expenseId, type: 'EXPENSE_CREATED' },
    })
    expect(activity).not.toBeNull()
    expect(activity!.actorType).toBe('ACCOUNT')
    expect(activity!.actorId).toBe(adminId)
    expect(activity!.subjectType).toBe('EXPENSE')
    expect(activity!.subjectId).toBe(expenseId)
    const data = activity!.data as Record<string, unknown>
    expect(data.kind).toBe('expense')
    expect(data.title).toBe('Test Dinner')
    expect(data.amount).toBe(3000)

    // Assert dispatcher event
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(capture.events.length).toBeGreaterThanOrEqual(1)
    const event = capture.events.find((e) => e.activityId === activity!.id)
    expect(event).toBeDefined()
    expect(event!.type).toBe('EXPENSE_CREATED')
    expect(event!.actor).toEqual({ type: 'ACCOUNT', id: adminId })
    expect(event!.subject).toEqual({ type: 'EXPENSE', id: expenseId })
    expect(event!.groupId).toBe(groupId)
  })

  // ------------------------------------------------------------------------
  // 2. Update expense — assert activity row + dispatcher event
  // ------------------------------------------------------------------------
  it('logs EXPENSE_UPDATED and dispatches when fields change', async () => {
    capture = new CapturingDispatcher()
    setDefaultActivityNotificationDispatchers([capture])

    const caller = makeCaller()
    await caller.expenses.update({
      groupId,
      expenseId,
      expense: {
        title: 'Updated Dinner',
        amount: 3500,
        paidByList: [
          { participant: adminParticipantId, shares: 1750 },
          { participant: recipientParticipantId, shares: 1750 },
        ],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: true,
        paidFor: [
          { participant: adminParticipantId, shares: 1 },
          { participant: recipientParticipantId, shares: 1 },
        ],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date('2026-07-02').toISOString(),
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    // Assert activity row
    const activity = await prisma.activity.findFirst({
      where: {
        subjectId: expenseId,
        type: 'EXPENSE_UPDATED',
      },
      orderBy: { time: 'desc' },
    })
    expect(activity).not.toBeNull()
    const data = activity!.data as Record<string, unknown>
    expect(data.kind).toBe('expense')
    expect(data.title).toBe('Updated Dinner')
    expect(data.changedFields).toEqual(expect.arrayContaining(['title', 'amount']))

    // Assert dispatcher event
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(capture.events.length).toBeGreaterThanOrEqual(1)
    const event = capture.events.find((e) => e.activityId === activity!.id)
    expect(event).toBeDefined()
    expect(event!.type).toBe('EXPENSE_UPDATED')
  })

  // ------------------------------------------------------------------------
  // 3. No-op update — assert no activity logged
  // ------------------------------------------------------------------------
  it('skips activity and dispatch when nothing changes', async () => {
    capture = new CapturingDispatcher()
    setDefaultActivityNotificationDispatchers([capture])

    const caller = makeCaller()
    const beforeCount = await prisma.activity.count({
      where: { subjectId: expenseId, type: 'EXPENSE_UPDATED' },
    })

    await caller.expenses.update({
      groupId,
      expenseId,
      expense: {
        title: 'Updated Dinner',
        amount: 3500,
        paidByList: [
          { participant: adminParticipantId, shares: 1750 },
          { participant: recipientParticipantId, shares: 1750 },
        ],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: true,
        paidFor: [
          { participant: adminParticipantId, shares: 1 },
          { participant: recipientParticipantId, shares: 1 },
        ],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date('2026-07-02').toISOString(),
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    const afterCount = await prisma.activity.count({
      where: { subjectId: expenseId, type: 'EXPENSE_UPDATED' },
    })
    expect(afterCount).toBe(beforeCount)

    // No new dispatcher events
    await new Promise((resolve) => setTimeout(resolve, 20))
    const updateEvents = capture.events.filter(
      (e) => e.type === 'EXPENSE_UPDATED',
    )
    expect(updateEvents).toHaveLength(0)
  })

  // ------------------------------------------------------------------------
  // 4. Delete expense — assert activity row + dispatcher event
  // ------------------------------------------------------------------------
  it('logs EXPENSE_DELETED and dispatches on delete', async () => {
    capture = new CapturingDispatcher()
    setDefaultActivityNotificationDispatchers([capture])

    const caller = makeCaller()
    await caller.expenses.delete({ groupId, expenseId })

    // Assert activity row
    const activity = await prisma.activity.findFirst({
      where: { subjectId: expenseId, type: 'EXPENSE_DELETED' },
    })
    expect(activity).not.toBeNull()
    expect(activity!.actorType).toBe('ACCOUNT')
    expect(activity!.actorId).toBe(adminId)
    const data = activity!.data as Record<string, unknown>
    expect(data.kind).toBe('expense')
    expect(data.title).toBe('Updated Dinner')
    expect(data.amount).toBe(3500)
    expect(data.affectedParticipants).toEqual(
      expect.arrayContaining([adminParticipantId, recipientParticipantId]),
    )

    // Assert dispatcher event
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(capture.events.length).toBeGreaterThanOrEqual(1)
    const event = capture.events.find((e) => e.activityId === activity!.id)
    expect(event).toBeDefined()
    expect(event!.type).toBe('EXPENSE_DELETED')
  })
})
