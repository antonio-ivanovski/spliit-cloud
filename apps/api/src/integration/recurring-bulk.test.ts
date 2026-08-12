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

/**
 * THIS_AND_FUTURE update/delete — per-row activity + notification correctness.
 *
 * Covers review findings F1–F5:
 *
 * 1. Future-row update diffs must be derived from a full snapshot diff, with real
 *    `changedFields`/`changes` and a per-row `affectedParticipants` union (NOT
 *    the hard-coded `['recurrence']`).
 * 2. When exactly one future row differs and the selected row already matches the
 *    new template, the single-row notification must still fire
 *    (sole-changed-future-row case).
 * 3. Notes-only updates to future rows must log a `notes` field change, not just
 *    `recurrence`.
 * 4. THIS_AND_FUTURE delete snapshots must include documents on later occurrences;
 *    cadence fields must surface in the summary data.
 */
describe('Recurring bulk updates — real DB', () => {
  const runId = testRunId()
  const adminId = `acct-rb-${runId}`
  const adminEmail = `rb-${runId}@test.example`
  const witnessId = `acct-rb-w-${runId}`
  const witnessEmail = `rb-w-${runId}@test.example`

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
    await prisma.account.upsert({
      where: { email: witnessEmail },
      update: {},
      create: {
        id: witnessId,
        email: witnessEmail,
        emailVerified: true,
        name: 'Test Witness',
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
    for (const lid of ledgerIds) {
      await prisma.ledger.delete({ where: { id: lid } }).catch(() => {})
    }
    await prisma.account.delete({ where: { id: adminId } }).catch(() => {})
    await prisma.account.delete({ where: { id: witnessId } }).catch(() => {})
  })

  /**
   * Create a group with admin + extra UNLINKED participants. The admin comes
   * from the tRPC caller; extras are inserted directly as UNLINKED_PARTICIPANT
   * ledger rows (matches the multi-payer harness). Returns the group id, ledger
   * id, and a name → ledgerParticipantId map.
   */
  async function createGroupWithParticipants(
    name: string,
    extraParticipantNames: string[],
  ): Promise<{
    groupId: string
    ledgerId: string
    participants: Record<string, string>
  }> {
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
    trackLedger(group!.ledger.id)
    const ledgerId = group!.ledger.id
    const adminLpId = group!.members[0].ledgerParticipant!.id
    const participants: Record<string, string> = { Admin: adminLpId }
    for (const participantName of extraParticipantNames) {
      const lp = await prisma.ledgerParticipant.create({
        data: {
          id: randomId(),
          ledgerId,
          kind: 'UNLINKED_PARTICIPANT',
          displayName: participantName,
        },
      })
      participants[participantName] = lp.id
    }
    return { groupId, ledgerId, participants }
  }

  /**
   * Add a real account-based member (active) to a freshly-created group.
   * Returns that member's ledgerParticipantId, so tests can exercise the
   * notification path that excludes the actor — only account-backed
   * LedgerParticipants resolve to a recipient.
   */
  async function addActiveMember(
    groupId: string,
    ledgerId: string,
  ): Promise<string> {
    const memberId = `gm-rb-w-${runId}-${randomId()}`
    const gm = await prisma.groupMember.create({
      data: {
        id: memberId,
        groupId,
        accountId: witnessId,
        role: GroupRole.MEMBER,
        status: GroupMemberStatus.ACTIVE,
        joinedAt: new Date(),
      },
    })
    const lp = await prisma.ledgerParticipant.create({
      data: {
        id: `lp-rb-w-${runId}-${randomId()}`,
        ledgerId,
        groupMemberId: gm.id,
      },
    })
    return lp.id
  }

  /**
   * Materialize a recurring expense past its next occurrence boundary, so the
   * recurring series has at least the original occurrence + 1 future occurrence
   * persisted. Returns the ids in creation order.
   */
  async function seedSeriesWithFutureOccurrences(args: {
    groupId: string
    participants: Record<string, string>
    title: string
    initialPaidFor: Array<{ participant: string; shares: number }>
  }): Promise<{
    seriesId: string
    expenseIds: string[]
  }> {
    const caller = makeCaller()
    const pastDate = new Date()
    pastDate.setUTCDate(pastDate.getUTCDate() - 14)
    const result = await caller.expenses.create({
      requestId: crypto.randomUUID(),
      groupId: args.groupId,
      expense: {
        title: args.title,
        amount: 6000,
        expenseDate: pastDate.toISOString(),
        expenseTimeZone: 'UTC',
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [{ participant: args.participants.Admin, shares: 6000 }],
        paidFor: args.initialPaidFor,
        isReimbursement: false,
        documents: [],
        recurrenceRule: 'WEEKLY',
      },
    })
    const originalId = result.expenseId
    const { materializeRecurringExpense } =
      await import('../lib/api/recurrence-series')
    let series = await prisma.recurringExpenseSeries.findFirst({
      where: {
        ledgerId: (
          await prisma.expense.findUniqueOrThrow({
            where: { id: originalId },
            select: { ledgerId: true },
          })
        ).ledgerId,
        template: { path: ['title'], equals: args.title },
      },
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
      where: { ledgerId: series!.ledgerId, title: args.title },
      orderBy: { createdAt: 'asc' },
      select: { id: true, recurrenceSequence: true },
    })
    return { seriesId: series!.id, expenseIds: cloned.map((c) => c.id) }
  }

  // ------------------------------------------------------------------------
  // F1 — Future-row paidFor change logs split/payers diff, not 'recurrence'
  // ------------------------------------------------------------------------
  it('THIS_AND_FUTURE paidFor change on future rows logs split (not recurrence)', async () => {
    const { groupId, participants } = await createGroupWithParticipants(
      `RB-F1-${runId}`,
      ['Bob'],
    )
    const { expenseIds } = await seedSeriesWithFutureOccurrences({
      groupId,
      participants,
      title: 'Pizza weekly',
      initialPaidFor: [
        { participant: participants.Admin, shares: 1 },
        { participant: participants.Bob, shares: 1 },
      ],
    })
    expect(expenseIds.length).toBeGreaterThanOrEqual(2)
    const targetId = expenseIds[0]!
    const futureIds = expenseIds.slice(1)

    await makeCaller().expenses.update({
      expectedVersion: (
        await prisma.expense.findUniqueOrThrow({
          where: { id: targetId },
          select: { version: true },
        })
      ).version,
      groupId,
      expenseId: targetId,
      scope: 'THIS_AND_FUTURE',
      expense: {
        title: 'Pizza weekly',
        amount: 6000,
        expenseDate: (
          await prisma.expense.findUniqueOrThrow({
            where: { id: targetId },
            select: { expenseDate: true },
          })
        ).expenseDate.toISOString(),
        expenseTimeZone: 'UTC',
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [{ participant: participants.Admin, shares: 6000 }],
        // Drop Bob from paidFor on the new template.
        paidFor: [{ participant: participants.Admin, shares: 1 }],
        isReimbursement: false,
        documents: [],
        recurrenceRule: 'WEEKLY',
        recurrence: {
          frequency: 'WEEKLY',
          interval: 1,
          end: { type: 'INDEFINITE' },
        },
      },
    })

    // The future rows must each carry an EXPENSE_UPDATED activity whose
    // changedFields flags 'split' or 'payers' (never 'recurrence'), with
    // affectedParticipants containing both Admin (still present) and Bob
    // (removed — but recipients still cover removed-by-change members).
    for (const futureId of futureIds) {
      const activity = await prisma.activity.findFirst({
        where: { subjectId: futureId, type: 'EXPENSE_UPDATED' },
        orderBy: { time: 'desc' },
      })
      expect(activity).not.toBeNull()
      const data = activity!.data as Record<string, unknown>
      const changedFields = data.changedFields as string[] | undefined
      expect(changedFields ?? []).not.toContain('recurrence')
      // The split differ flags the change either via 'split' or 'payers'.
      expect(changedFields ?? []).toEqual(expect.arrayContaining(['split']))
      const participantsList = data.affectedParticipants as string[] | undefined
      expect(participantsList).toEqual(
        expect.arrayContaining([participants.Admin, participants.Bob]),
      )
    }
  })

  // ------------------------------------------------------------------------
  // F2 — Sole changed future row produces a single notification payload
  // ------------------------------------------------------------------------
  it('THIS_AND_FUTURE where only a future row differs logs exactly one activity', async () => {
    const { groupId, participants } = await createGroupWithParticipants(
      `RB-F2-${runId}`,
      ['Bob'],
    )
    const { expenseIds } = await seedSeriesWithFutureOccurrences({
      groupId,
      participants,
      title: 'Streaming',
      initialPaidFor: [
        { participant: participants.Admin, shares: 1 },
        { participant: participants.Bob, shares: 1 },
      ],
    })
    expect(expenseIds.length).toBeGreaterThanOrEqual(3)
    const targetId = expenseIds[0]!
    const laterId = expenseIds[2]!

    // Manually adjust a single later row to pre-divert it from the new
    // template: Bob dropped, title left intact. After the THIS_AND_FUTURE
    // update the selected row matches the new template exactly, and only
    // the manually-adjusted later row will see a real diff.
    await prisma.expense.update({
      where: { id: laterId },
      data: { title: 'Old streaming' },
    })

    const beforeSelectedActivities = await prisma.activity.count({
      where: { subjectId: targetId, type: 'EXPENSE_UPDATED' },
    })

    await makeCaller().expenses.update({
      expectedVersion: (
        await prisma.expense.findUniqueOrThrow({
          where: { id: targetId },
          select: { version: true },
        })
      ).version,
      groupId,
      expenseId: targetId,
      scope: 'THIS_AND_FUTURE',
      expense: {
        // Reverts the manual title edit on the later row.
        title: 'Streaming',
        amount: 6000,
        expenseDate: (
          await prisma.expense.findUniqueOrThrow({
            where: { id: targetId },
            select: { expenseDate: true },
          })
        ).expenseDate.toISOString(),
        expenseTimeZone: 'UTC',
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [{ participant: participants.Admin, shares: 6000 }],
        paidFor: [
          { participant: participants.Admin, shares: 1 },
          { participant: participants.Bob, shares: 1 },
        ],
        isReimbursement: false,
        documents: [],
        recurrenceRule: 'WEEKLY',
        recurrence: {
          frequency: 'WEEKLY',
          interval: 1,
          end: { type: 'INDEFINITE' },
        },
      },
    })

    // The selected expense itself matches the new template — no new
    // EXPENSE_UPDATED activity for it.
    const afterSelectedActivities = await prisma.activity.count({
      where: { subjectId: targetId, type: 'EXPENSE_UPDATED' },
    })
    expect(afterSelectedActivities).toBe(beforeSelectedActivities)

    // Exactly one future-row activity — the manually-adjusted row's title
    // being reverted to the new template.
    const futureRowActivities = await prisma.activity.findMany({
      where: {
        type: 'EXPENSE_UPDATED',
        subjectId: { in: expenseIds.slice(1) },
      },
    })
    expect(futureRowActivities).toHaveLength(1)
    const soleActivity = futureRowActivities[0]!
    expect(soleActivity.subjectId).toBe(laterId)
    const soleData = soleActivity.data as Record<string, unknown>
    expect(soleData.title).toBe('Streaming')
    expect((soleData.changedFields as string[]) ?? []).toEqual(
      expect.arrayContaining(['title']),
    )
  })

  // ------------------------------------------------------------------------
  // F3 — Notes-only update on future rows logs 'notes' (not 'recurrence')
  // ------------------------------------------------------------------------
  it('THIS_AND_FUTURE notes-only change logs notes on future rows', async () => {
    const { groupId, participants } = await createGroupWithParticipants(
      `RB-F3-${runId}`,
      [],
    )
    const { expenseIds } = await seedSeriesWithFutureOccurrences({
      groupId,
      participants,
      title: 'Notes test',
      initialPaidFor: [{ participant: participants.Admin, shares: 1 }],
    })
    expect(expenseIds.length).toBeGreaterThanOrEqual(2)
    const targetId = expenseIds[0]!
    const futureIds = expenseIds.slice(1)

    await makeCaller().expenses.update({
      expectedVersion: (
        await prisma.expense.findUniqueOrThrow({
          where: { id: targetId },
          select: { version: true },
        })
      ).version,
      groupId,
      expenseId: targetId,
      scope: 'THIS_AND_FUTURE',
      expense: {
        title: 'Notes test',
        amount: 6000,
        expenseDate: (
          await prisma.expense.findUniqueOrThrow({
            where: { id: targetId },
            select: { expenseDate: true },
          })
        ).expenseDate.toISOString(),
        expenseTimeZone: 'UTC',
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [{ participant: participants.Admin, shares: 6000 }],
        paidFor: [{ participant: participants.Admin, shares: 1 }],
        isReimbursement: false,
        notes: 'added by test',
        documents: [],
        recurrenceRule: 'WEEKLY',
        recurrence: {
          frequency: 'WEEKLY',
          interval: 1,
          end: { type: 'INDEFINITE' },
        },
      },
    })

    for (const futureId of futureIds) {
      const activity = await prisma.activity.findFirst({
        where: { subjectId: futureId, type: 'EXPENSE_UPDATED' },
        orderBy: { time: 'desc' },
      })
      expect(activity).not.toBeNull()
      const data = activity!.data as Record<string, unknown>
      expect((data.changedFields as string[]) ?? []).toEqual(
        expect.arrayContaining(['notes']),
      )
      expect((data.changedFields as string[]) ?? []).not.toContain('recurrence')
    }
  })

  // ------------------------------------------------------------------------
  // F3b — Reimbursement-only update on future rows logs 'reimbursement'
  // ------------------------------------------------------------------------
  it('THIS_AND_FUTURE reimbursement-only change logs reimbursement on future rows', async () => {
    const { groupId, participants } = await createGroupWithParticipants(
      `RB-F3b-${runId}`,
      [],
    )
    const { expenseIds } = await seedSeriesWithFutureOccurrences({
      groupId,
      participants,
      title: 'Reimbursement test',
      initialPaidFor: [{ participant: participants.Admin, shares: 1 }],
    })
    expect(expenseIds.length).toBeGreaterThanOrEqual(2)
    const targetId = expenseIds[0]!
    const futureIds = expenseIds.slice(1)

    await makeCaller().expenses.update({
      expectedVersion: (
        await prisma.expense.findUniqueOrThrow({
          where: { id: targetId },
          select: { version: true },
        })
      ).version,
      groupId,
      expenseId: targetId,
      scope: 'THIS_AND_FUTURE',
      expense: {
        title: 'Reimbursement test',
        amount: 6000,
        expenseDate: (
          await prisma.expense.findUniqueOrThrow({
            where: { id: targetId },
            select: { expenseDate: true },
          })
        ).expenseDate.toISOString(),
        expenseTimeZone: 'UTC',
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [{ participant: participants.Admin, shares: 6000 }],
        paidFor: [{ participant: participants.Admin, shares: 1 }],
        isReimbursement: true,
        documents: [],
        recurrenceRule: 'WEEKLY',
        recurrence: {
          frequency: 'WEEKLY',
          interval: 1,
          end: { type: 'INDEFINITE' },
        },
      },
    })

    for (const futureId of futureIds) {
      const activity = await prisma.activity.findFirst({
        where: { subjectId: futureId, type: 'EXPENSE_UPDATED' },
        orderBy: { time: 'desc' },
      })
      expect(activity).not.toBeNull()
      const data = activity!.data as Record<string, unknown>
      expect((data.changedFields as string[]) ?? []).toEqual(
        expect.arrayContaining(['reimbursement']),
      )
      expect((data.changedFields as string[]) ?? []).not.toContain('recurrence')
    }
  })

  // ------------------------------------------------------------------------
  // F5 — THIS_AND_FUTURE delete summary exposes cadence fields
  // ------------------------------------------------------------------------
  it('THIS_AND_FUTURE delete summary carries frequency/interval/endType/seriesEndDate', async () => {
    // Two paidFor participants so the summary notification reaches
    // somebody other than the admin actor (handlers exclude the actor).
    const { groupId, ledgerId, participants } =
      await createGroupWithParticipants(`RB-F5-${runId}`, [])
    const witnessLpId = await addActiveMember(groupId, ledgerId)
    const witnesses = { ...participants, Witness: witnessLpId }
    const { expenseIds } = await seedSeriesWithFutureOccurrences({
      groupId,
      participants: witnesses,
      title: 'Rent weekly',
      initialPaidFor: [
        { participant: witnesses.Admin, shares: 1 },
        { participant: witnesses.Witness, shares: 1 },
      ],
    })
    expect(expenseIds.length).toBeGreaterThanOrEqual(2)
    const targetId = expenseIds[0]!

    const capture = new CapturingDispatcher()
    setDefaultActivityNotificationDispatchers([capture])

    await makeCaller().expenses.delete({
      groupId,
      expenseId: targetId,
      scope: 'THIS_AND_FUTURE',
    })

    await waitForScheduledNotificationDispatchesForTest()
    const summaryEvent = capture.events.find(
      (e) => e.type === 'EXPENSE_DELETED' && e.subject === null,
    )
    expect(summaryEvent).toBeDefined()
    const data = summaryEvent!.data as Record<string, unknown>
    expect(data.kind).toBe('recurring_expense_summary')
    expect(data.frequency).toBe('WEEKLY')
    expect(data.interval).toBe(1)
    expect(data.endType).toBe('INDEFINITE')
    expect(data.operation).toBe('delete')
    expect(typeof data.count).toBe('number')
    expect((data.count as number) >= 2).toBe(true)
    expect(typeof data.startDate).toBe('string')
    expect(typeof data.endDate).toBe('string')
  })

  // ------------------------------------------------------------------------
  // D3 — Schedule reflow on THIS_AND_FUTURE frequency change
  // ------------------------------------------------------------------------
  it('THIS_AND_FUTURE weekly→daily redates future rows and seeds catch-up', async () => {
    const { groupId, participants } = await createGroupWithParticipants(
      `RB-D3-daily-${runId}`,
      ['Bob'],
    )
    const { seriesId, expenseIds } = await seedSeriesWithFutureOccurrences({
      groupId,
      participants,
      title: 'Weekly to daily',
      initialPaidFor: [
        { participant: participants.Admin, shares: 1 },
        { participant: participants.Bob, shares: 1 },
      ],
    })
    expect(expenseIds.length).toBeGreaterThanOrEqual(3)
    const targetId = expenseIds[0]!
    const pastIds = expenseIds.slice(0, 1)
    const futureBefore = await prisma.expense.findMany({
      where: { id: { in: expenseIds.slice(1) } },
      orderBy: { recurrenceSequence: 'asc' },
      select: { id: true, expenseDate: true, recurrenceSequence: true },
    })
    const target = await prisma.expense.findUniqueOrThrow({
      where: { id: targetId },
      select: { expenseDate: true, recurrenceSequence: true },
    })

    await makeCaller().expenses.update({
      expectedVersion: (
        await prisma.expense.findUniqueOrThrow({
          where: { id: targetId },
          select: { version: true },
        })
      ).version,
      groupId,
      expenseId: targetId,
      scope: 'THIS_AND_FUTURE',
      expense: {
        title: 'Weekly to daily',
        amount: 6000,
        expenseDate: target.expenseDate.toISOString(),
        expenseTimeZone: 'UTC',
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [{ participant: participants.Admin, shares: 6000 }],
        paidFor: [
          { participant: participants.Admin, shares: 1 },
          { participant: participants.Bob, shares: 1 },
        ],
        isReimbursement: false,
        documents: [],
        recurrenceRule: 'DAILY',
        recurrence: {
          frequency: 'DAILY',
          interval: 1,
          end: { type: 'INDEFINITE' },
        },
      },
    })

    const series = await prisma.recurringExpenseSeries.findUniqueOrThrow({
      where: { id: seriesId },
    })
    expect(series.frequency).toBe('DAILY')
    expect(series.interval).toBe(1)
    expect(series.catchUpBatch).not.toBeNull()

    const futureAfter = await prisma.expense.findMany({
      where: { id: { in: futureBefore.map((r) => r.id) } },
      orderBy: { recurrenceSequence: 'asc' },
      select: { id: true, expenseDate: true, recurrenceSequence: true },
    })
    expect(futureAfter.length).toBe(futureBefore.length)
    const anchorSeq = target.recurrenceSequence ?? 1
    for (const row of futureAfter) {
      const seq = row.recurrenceSequence ?? anchorSeq
      const ordinal = seq - anchorSeq + 1
      const expected = new Date(target.expenseDate)
      expected.setUTCDate(expected.getUTCDate() + (ordinal - 1))
      expect(row.expenseDate.toISOString().slice(0, 10)).toBe(
        expected.toISOString().slice(0, 10),
      )
    }

    // Past-before-anchor rows are untouched when editing a later occurrence.
    // Here we edited the first occurrence, so only check the selected row kept
    // its date.
    const stillPast = await prisma.expense.findMany({
      where: { id: { in: pastIds } },
      select: { expenseDate: true },
    })
    expect(stillPast[0]!.expenseDate.toISOString().slice(0, 10)).toBe(
      target.expenseDate.toISOString().slice(0, 10),
    )
  })

  it('THIS_AND_FUTURE daily→weekly redates future rows without deleting in-band', async () => {
    const { groupId, participants } = await createGroupWithParticipants(
      `RB-D3-weekly-${runId}`,
      ['Bob'],
    )
    const caller = makeCaller()
    const pastDate = new Date()
    pastDate.setUTCDate(pastDate.getUTCDate() - 5)
    const created = await caller.expenses.create({
      requestId: crypto.randomUUID(),
      groupId,
      expense: {
        title: 'Daily to weekly',
        amount: 3000,
        expenseDate: pastDate.toISOString(),
        expenseTimeZone: 'UTC',
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [{ participant: participants.Admin, shares: 3000 }],
        paidFor: [
          { participant: participants.Admin, shares: 1 },
          { participant: participants.Bob, shares: 1 },
        ],
        isReimbursement: false,
        documents: [],
        recurrenceRule: 'DAILY',
        // Keep COUNT high so catch-up through today leaves the series ACTIVE
        // (terminal series intentionally skip schedule reflow).
        recurrence: {
          frequency: 'DAILY',
          interval: 1,
          end: { type: 'COUNT', count: 30 },
        },
      },
    })
    const { materializeRecurringExpense } =
      await import('../lib/api/recurrence-series')
    let series = await prisma.recurringExpenseSeries.findUniqueOrThrow({
      where: { id: created.recurringSeriesId! },
    })
    while (
      series.nextOccurrenceDate <= new Date() &&
      series.status === 'ACTIVE'
    ) {
      await materializeRecurringExpense({
        seriesId: series.id,
        sequence: series.occurrencesCreated + 1,
        occurrenceDate: series.nextOccurrenceDate.toISOString().slice(0, 10),
      })
      series = await prisma.recurringExpenseSeries.findUniqueOrThrow({
        where: { id: series.id },
      })
    }
    expect(series.status).toBe('ACTIVE')
    const rows = await prisma.expense.findMany({
      where: { recurringSeriesId: series.id },
      orderBy: { recurrenceSequence: 'asc' },
      select: { id: true, expenseDate: true, recurrenceSequence: true },
    })
    expect(rows.length).toBeGreaterThanOrEqual(3)
    const target = rows[0]!
    const beforeCount = rows.length

    await caller.expenses.update({
      expectedVersion: (
        await prisma.expense.findUniqueOrThrow({
          where: { id: target.id },
          select: { version: true },
        })
      ).version,
      groupId,
      expenseId: target.id,
      scope: 'THIS_AND_FUTURE',
      expense: {
        title: 'Daily to weekly',
        amount: 3000,
        expenseDate: target.expenseDate.toISOString(),
        expenseTimeZone: 'UTC',
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [{ participant: participants.Admin, shares: 3000 }],
        paidFor: [
          { participant: participants.Admin, shares: 1 },
          { participant: participants.Bob, shares: 1 },
        ],
        isReimbursement: false,
        documents: [],
        recurrenceRule: 'WEEKLY',
        recurrence: {
          frequency: 'WEEKLY',
          interval: 1,
          end: { type: 'COUNT', count: 30 },
        },
      },
    })

    const after = await prisma.expense.findMany({
      where: { recurringSeriesId: series.id },
      orderBy: { recurrenceSequence: 'asc' },
      select: { id: true, expenseDate: true, recurrenceSequence: true },
    })
    expect(after.length).toBe(beforeCount)
    for (const row of after) {
      const seq = row.recurrenceSequence ?? 1
      const expected = new Date(target.expenseDate)
      expected.setUTCDate(expected.getUTCDate() + (seq - 1) * 7)
      expect(row.expenseDate.toISOString().slice(0, 10)).toBe(
        expected.toISOString().slice(0, 10),
      )
    }
  })

  it('THIS_AND_FUTURE shortened COUNT deletes out-of-band future rows', async () => {
    const { groupId, participants } = await createGroupWithParticipants(
      `RB-D3-count-${runId}`,
      ['Bob'],
    )
    const { seriesId, expenseIds } = await seedSeriesWithFutureOccurrences({
      groupId,
      participants,
      title: 'Count truncate',
      initialPaidFor: [
        { participant: participants.Admin, shares: 1 },
        { participant: participants.Bob, shares: 1 },
      ],
    })
    expect(expenseIds.length).toBeGreaterThanOrEqual(3)
    const target = await prisma.expense.findUniqueOrThrow({
      where: { id: expenseIds[0]! },
      select: { id: true, expenseDate: true, recurrenceSequence: true },
    })
    const keepThrough = target.recurrenceSequence! + 1

    await makeCaller().expenses.update({
      expectedVersion: (
        await prisma.expense.findUniqueOrThrow({
          where: { id: target.id },
          select: { version: true },
        })
      ).version,
      groupId,
      expenseId: target.id,
      scope: 'THIS_AND_FUTURE',
      expense: {
        title: 'Count truncate',
        amount: 6000,
        expenseDate: target.expenseDate.toISOString(),
        expenseTimeZone: 'UTC',
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [{ participant: participants.Admin, shares: 6000 }],
        paidFor: [
          { participant: participants.Admin, shares: 1 },
          { participant: participants.Bob, shares: 1 },
        ],
        isReimbursement: false,
        documents: [],
        recurrenceRule: 'WEEKLY',
        recurrence: {
          frequency: 'WEEKLY',
          interval: 1,
          end: { type: 'COUNT', count: keepThrough },
        },
      },
    })

    const remaining = await prisma.expense.findMany({
      where: { recurringSeriesId: seriesId },
      orderBy: { recurrenceSequence: 'asc' },
      select: { recurrenceSequence: true },
    })
    expect(
      remaining.every((r) => (r.recurrenceSequence ?? 0) <= keepThrough),
    ).toBe(true)
    expect(remaining.some((r) => r.recurrenceSequence === keepThrough)).toBe(
      true,
    )
    const series = await prisma.recurringExpenseSeries.findUniqueOrThrow({
      where: { id: seriesId },
    })
    expect(series.occurrenceLimit).toBe(keepThrough)
  })

  it('OCCURRENCE scope does not reflow the series schedule', async () => {
    const { groupId, participants } = await createGroupWithParticipants(
      `RB-D3-occ-${runId}`,
      ['Bob'],
    )
    const { seriesId, expenseIds } = await seedSeriesWithFutureOccurrences({
      groupId,
      participants,
      title: 'Occurrence only',
      initialPaidFor: [
        { participant: participants.Admin, shares: 1 },
        { participant: participants.Bob, shares: 1 },
      ],
    })
    const target = await prisma.expense.findUniqueOrThrow({
      where: { id: expenseIds[0]! },
      select: { id: true, expenseDate: true },
    })
    const beforeSeries = await prisma.recurringExpenseSeries.findUniqueOrThrow({
      where: { id: seriesId },
    })
    const beforeFuture = await prisma.expense.findMany({
      where: { id: { in: expenseIds.slice(1) } },
      select: { id: true, expenseDate: true },
    })

    await makeCaller().expenses.update({
      expectedVersion: (
        await prisma.expense.findUniqueOrThrow({
          where: { id: target.id },
          select: { version: true },
        })
      ).version,
      groupId,
      expenseId: target.id,
      scope: 'OCCURRENCE',
      expense: {
        title: 'Occurrence only',
        amount: 6000,
        expenseDate: target.expenseDate.toISOString(),
        expenseTimeZone: 'UTC',
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [{ participant: participants.Admin, shares: 6000 }],
        paidFor: [
          { participant: participants.Admin, shares: 1 },
          { participant: participants.Bob, shares: 1 },
        ],
        isReimbursement: false,
        documents: [],
        recurrenceRule: 'DAILY',
        recurrence: {
          frequency: 'DAILY',
          interval: 1,
          end: { type: 'INDEFINITE' },
        },
      },
    })

    const afterSeries = await prisma.recurringExpenseSeries.findUniqueOrThrow({
      where: { id: seriesId },
    })
    expect(afterSeries.frequency).toBe(beforeSeries.frequency)
    expect(afterSeries.interval).toBe(beforeSeries.interval)
    const afterFuture = await prisma.expense.findMany({
      where: { id: { in: beforeFuture.map((r) => r.id) } },
      select: { id: true, expenseDate: true },
    })
    for (const row of beforeFuture) {
      const after = afterFuture.find((r) => r.id === row.id)!
      expect(after.expenseDate.toISOString()).toBe(
        row.expenseDate.toISOString(),
      )
    }
  })

  it('THIS_AND_FUTURE reflow leaves past-before-anchor rows untouched', async () => {
    const { groupId, participants } = await createGroupWithParticipants(
      `RB-D3-past-${runId}`,
      ['Bob'],
    )
    const { seriesId, expenseIds } = await seedSeriesWithFutureOccurrences({
      groupId,
      participants,
      title: 'Past untouched',
      initialPaidFor: [
        { participant: participants.Admin, shares: 1 },
        { participant: participants.Bob, shares: 1 },
      ],
    })
    expect(expenseIds.length).toBeGreaterThanOrEqual(3)
    const editTargetId = expenseIds[1]!
    const pastRow = await prisma.expense.findUniqueOrThrow({
      where: { id: expenseIds[0]! },
      select: { id: true, expenseDate: true, title: true },
    })
    const editTarget = await prisma.expense.findUniqueOrThrow({
      where: { id: editTargetId },
      select: { expenseDate: true, recurrenceSequence: true },
    })

    await makeCaller().expenses.update({
      expectedVersion: (
        await prisma.expense.findUniqueOrThrow({
          where: { id: editTargetId },
          select: { version: true },
        })
      ).version,
      groupId,
      expenseId: editTargetId,
      scope: 'THIS_AND_FUTURE',
      expense: {
        title: 'Past untouched',
        amount: 6000,
        expenseDate: editTarget.expenseDate.toISOString(),
        expenseTimeZone: 'UTC',
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [{ participant: participants.Admin, shares: 6000 }],
        paidFor: [
          { participant: participants.Admin, shares: 1 },
          { participant: participants.Bob, shares: 1 },
        ],
        isReimbursement: false,
        documents: [],
        recurrenceRule: 'DAILY',
        recurrence: {
          frequency: 'DAILY',
          interval: 1,
          end: { type: 'INDEFINITE' },
        },
      },
    })

    const stillPast = await prisma.expense.findUniqueOrThrow({
      where: { id: pastRow.id },
      select: { expenseDate: true, title: true },
    })
    expect(stillPast.expenseDate.toISOString()).toBe(
      pastRow.expenseDate.toISOString(),
    )
    expect(stillPast.title).toBe(pastRow.title)

    const series = await prisma.recurringExpenseSeries.findUniqueOrThrow({
      where: { id: seriesId },
    })
    expect(series.frequency).toBe('DAILY')
    expect(series.anchorSequence).toBe(editTarget.recurrenceSequence)
  })

  // ------------------------------------------------------------------------
  // DS1 — THIS_AND_FUTURE delete + stopRecurrence cancels series and
  //       marks the summary notification payload as stopped.
  // ------------------------------------------------------------------------
  it('THIS_AND_FUTURE delete with stopRecurrence cancels series and marks payload stopped', async () => {
    const { groupId, ledgerId, participants } =
      await createGroupWithParticipants(`RB-DS1-${runId}`, [])
    const witnessLpId = await addActiveMember(groupId, ledgerId)
    const witnesses = { ...participants, Witness: witnessLpId }
    const { seriesId, expenseIds } = await seedSeriesWithFutureOccurrences({
      groupId,
      participants: witnesses,
      title: 'Series to stop',
      initialPaidFor: [
        { participant: witnesses.Admin, shares: 1 },
        { participant: witnesses.Witness, shares: 1 },
      ],
    })
    expect(expenseIds.length).toBeGreaterThanOrEqual(3)
    const targetId = expenseIds[1]!
    const targetRow = await prisma.expense.findUniqueOrThrow({
      where: { id: targetId },
      select: { recurrenceSequence: true },
    })
    const seq = targetRow.recurrenceSequence!

    const rowsBefore = await prisma.expense.findMany({
      where: { recurringSeriesId: seriesId },
      orderBy: { recurrenceSequence: 'asc' },
      select: { id: true, recurrenceSequence: true },
    })

    const capture = new CapturingDispatcher()
    setDefaultActivityNotificationDispatchers([capture])

    await makeCaller().expenses.delete({
      groupId,
      expenseId: targetId,
      scope: 'THIS_AND_FUTURE',
      stopRecurrence: true,
    })

    await waitForScheduledNotificationDispatchesForTest()

    const rowsAfter = await prisma.expense.findMany({
      where: { recurringSeriesId: seriesId },
      orderBy: { recurrenceSequence: 'asc' },
      select: { id: true, recurrenceSequence: true },
    })

    const earlierRows = rowsBefore.filter((r) => r.recurrenceSequence! < seq)
    const laterRows = rowsBefore.filter((r) => r.recurrenceSequence! >= seq)
    expect(rowsAfter).toHaveLength(earlierRows.length)
    for (const earlier of earlierRows) {
      expect(rowsAfter.find((r) => r.id === earlier.id)).toBeDefined()
    }
    for (const later of laterRows) {
      expect(rowsAfter.find((r) => r.id === later.id)).toBeUndefined()
    }

    const series = await prisma.recurringExpenseSeries.findUniqueOrThrow({
      where: { id: seriesId },
    })
    expect(series.status).toBe('CANCELLED')

    const summaryEvents = capture.events.filter(
      (e) => e.type === 'EXPENSE_DELETED' && e.subject === null,
    )
    expect(summaryEvents).toHaveLength(1)
    const data = summaryEvents[0]!.data as Record<string, unknown>
    expect(data.kind).toBe('recurring_expense_summary')
    expect(data.stopped).toBe(true)
    expect(data.frequency).toBe('WEEKLY')
    expect(data.interval).toBe(1)
    expect(data.endType).toBe('INDEFINITE')
    expect(data.operation).toBe('delete')
  })

  // ------------------------------------------------------------------------
  // DS2 — OCCURRENCE-scope delete removes only the target row, leaving
  //       the series active and occurrencesCreated monotonic.
  // ------------------------------------------------------------------------
  it('OCCURRENCE scope delete preserves series and other rows', async () => {
    const { groupId, participants } = await createGroupWithParticipants(
      `RB-DS2-${runId}`,
      ['Bob'],
    )
    const { seriesId, expenseIds } = await seedSeriesWithFutureOccurrences({
      groupId,
      participants,
      title: 'Occurrence delete',
      initialPaidFor: [
        { participant: participants.Admin, shares: 1 },
        { participant: participants.Bob, shares: 1 },
      ],
    })
    expect(expenseIds.length).toBeGreaterThanOrEqual(3)
    const targetId = expenseIds[1]!
    const beforeSeries = await prisma.recurringExpenseSeries.findUniqueOrThrow({
      where: { id: seriesId },
    })
    const beforeRows = await prisma.expense.findMany({
      where: { recurringSeriesId: seriesId },
      orderBy: { recurrenceSequence: 'asc' },
      select: { id: true, recurrenceSequence: true, recurringSeriesId: true },
    })

    await makeCaller().expenses.delete({
      groupId,
      expenseId: targetId,
      scope: 'OCCURRENCE',
    })

    const deletedRow = await prisma.expense.findUnique({
      where: { id: targetId },
    })
    expect(deletedRow).toBeNull()

    const afterRows = await prisma.expense.findMany({
      where: { recurringSeriesId: seriesId },
      orderBy: { recurrenceSequence: 'asc' },
      select: { id: true, recurrenceSequence: true, recurringSeriesId: true },
    })
    expect(afterRows).toHaveLength(beforeRows.length - 1)
    for (const after of afterRows) {
      const before = beforeRows.find((r) => r.id === after.id)!
      expect(after.recurringSeriesId).toBe(before.recurringSeriesId)
      expect(after.recurrenceSequence).toBe(before.recurrenceSequence)
    }

    const afterSeries = await prisma.recurringExpenseSeries.findUniqueOrThrow({
      where: { id: seriesId },
    })
    expect(afterSeries.status).toBe('ACTIVE')
    expect(afterSeries.occurrencesCreated).toBe(beforeSeries.occurrencesCreated)
  })

  // ------------------------------------------------------------------------
  // DS3 — Standalone stopRecurrence keeps materialized rows, flips the
  //       series to CANCELLED, logs RECURRING_EXPENSE_STOPPED, and blocks
  //       further materialization.
  // ------------------------------------------------------------------------
  it('standalone stopRecurrence preserves expenses and logs RECURRING_EXPENSE_STOPPED', async () => {
    const { groupId, participants } = await createGroupWithParticipants(
      `RB-DS3-${runId}`,
      ['Bob'],
    )
    const { seriesId, expenseIds } = await seedSeriesWithFutureOccurrences({
      groupId,
      participants,
      title: 'Stop only',
      initialPaidFor: [
        { participant: participants.Admin, shares: 1 },
        { participant: participants.Bob, shares: 1 },
      ],
    })
    expect(expenseIds.length).toBeGreaterThanOrEqual(2)
    const targetId = expenseIds[0]!
    const seriesBefore = await prisma.recurringExpenseSeries.findUniqueOrThrow({
      where: { id: seriesId },
    })

    await makeCaller().expenses.stopRecurrence({
      groupId,
      expenseId: targetId,
    })

    const afterRows = await prisma.expense.findMany({
      where: { recurringSeriesId: seriesId },
      select: { id: true },
    })
    expect(afterRows).toHaveLength(expenseIds.length)
    for (const id of expenseIds) {
      expect(afterRows.find((r) => r.id === id)).toBeDefined()
    }

    const series = await prisma.recurringExpenseSeries.findUniqueOrThrow({
      where: { id: seriesId },
    })
    expect(series.status).toBe('CANCELLED')

    const activity = await prisma.activity.findFirst({
      where: {
        type: 'RECURRING_EXPENSE_STOPPED',
        subjectId: targetId,
      },
    })
    expect(activity).not.toBeNull()
    const activityData = activity!.data as Record<string, unknown>
    expect(activityData.kind).toBe('recurring_expense_stopped')
    expect(activityData.seriesId).toBe(seriesId)

    const { materializeRecurringExpense } =
      await import('../lib/api/recurrence-series')
    const result = await materializeRecurringExpense({
      seriesId: seriesBefore.id,
      sequence: seriesBefore.occurrencesCreated + 1,
      occurrenceDate: seriesBefore.nextOccurrenceDate
        .toISOString()
        .slice(0, 10),
    })
    expect(result.created).toBe(false)
  })

  // ------------------------------------------------------------------------
  // DS4 — Natural COUNT completion fires at the occurrence limit and
  //       blocks further materialization.
  // ------------------------------------------------------------------------
  it('natural COUNT completion stops materialization at the limit', async () => {
    const { groupId, participants } = await createGroupWithParticipants(
      `RB-DS4-${runId}`,
      ['Bob'],
    )
    const caller = makeCaller()
    const pastDate = new Date()
    pastDate.setUTCDate(pastDate.getUTCDate() - 14)
    const created = await caller.expenses.create({
      requestId: crypto.randomUUID(),
      groupId,
      expense: {
        title: 'Count complete',
        amount: 6000,
        expenseDate: pastDate.toISOString(),
        expenseTimeZone: 'UTC',
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [{ participant: participants.Admin, shares: 6000 }],
        paidFor: [{ participant: participants.Admin, shares: 1 }],
        isReimbursement: false,
        documents: [],
        recurrenceRule: 'WEEKLY',
        recurrence: {
          frequency: 'WEEKLY',
          interval: 1,
          end: { type: 'COUNT', count: 2 },
        },
      },
    })
    const seriesId = created.recurringSeriesId!
    const { materializeRecurringExpense } =
      await import('../lib/api/recurrence-series')
    let series = await prisma.recurringExpenseSeries.findUniqueOrThrow({
      where: { id: seriesId },
    })
    while (
      series.status === 'ACTIVE' &&
      series.nextOccurrenceDate <= new Date()
    ) {
      await materializeRecurringExpense({
        seriesId: series.id,
        sequence: series.occurrencesCreated + 1,
        occurrenceDate: series.nextOccurrenceDate.toISOString().slice(0, 10),
      })
      series = await prisma.recurringExpenseSeries.findUniqueOrThrow({
        where: { id: series.id },
      })
    }
    expect(series.status).toBe('COMPLETED')

    const rows = await prisma.expense.findMany({
      where: { recurringSeriesId: seriesId },
      orderBy: { recurrenceSequence: 'asc' },
    })
    expect(rows).toHaveLength(2)

    const next = await materializeRecurringExpense({
      seriesId,
      sequence: series.occurrencesCreated + 1,
      occurrenceDate: series.nextOccurrenceDate.toISOString().slice(0, 10),
    })
    expect(next.created).toBe(false)
  })

  // ------------------------------------------------------------------------
  // DS5 — Natural DATE completion fires once the next occurrence falls
  //       past endDate; no rows are materialized beyond the end date.
  // ------------------------------------------------------------------------
  it('natural DATE completion stops materialization at endDate', async () => {
    const { groupId, participants } = await createGroupWithParticipants(
      `RB-DS5-${runId}`,
      ['Bob'],
    )
    const caller = makeCaller()
    const anchorDate = new Date()
    anchorDate.setUTCDate(anchorDate.getUTCDate() - 14)
    const endDate = new Date()
    endDate.setUTCDate(endDate.getUTCDate() - 7)
    const created = await caller.expenses.create({
      requestId: crypto.randomUUID(),
      groupId,
      expense: {
        title: 'Date complete',
        amount: 6000,
        expenseDate: anchorDate.toISOString(),
        expenseTimeZone: 'UTC',
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [{ participant: participants.Admin, shares: 6000 }],
        paidFor: [{ participant: participants.Admin, shares: 1 }],
        isReimbursement: false,
        documents: [],
        recurrenceRule: 'WEEKLY',
        recurrence: {
          frequency: 'WEEKLY',
          interval: 1,
          end: { type: 'DATE', endDate: endDate.toISOString() },
        },
      },
    })
    const seriesId = created.recurringSeriesId!
    const { materializeRecurringExpense } =
      await import('../lib/api/recurrence-series')
    let series = await prisma.recurringExpenseSeries.findUniqueOrThrow({
      where: { id: seriesId },
    })
    while (
      series.status === 'ACTIVE' &&
      series.nextOccurrenceDate <= new Date()
    ) {
      await materializeRecurringExpense({
        seriesId: series.id,
        sequence: series.occurrencesCreated + 1,
        occurrenceDate: series.nextOccurrenceDate.toISOString().slice(0, 10),
      })
      series = await prisma.recurringExpenseSeries.findUniqueOrThrow({
        where: { id: series.id },
      })
    }
    expect(series.status).toBe('COMPLETED')

    const rows = await prisma.expense.findMany({
      where: { recurringSeriesId: seriesId },
      orderBy: { recurrenceSequence: 'asc' },
      select: { expenseDate: true },
    })
    expect(rows.length).toBeGreaterThanOrEqual(1)
    for (const row of rows) {
      expect(row.expenseDate.getTime() <= endDate.getTime()).toBe(true)
    }

    const next = await materializeRecurringExpense({
      seriesId,
      sequence: series.occurrencesCreated + 1,
      occurrenceDate: series.nextOccurrenceDate.toISOString().slice(0, 10),
    })
    expect(next.created).toBe(false)
  })

  // ------------------------------------------------------------------------
  // DS6 — Series navigation skips a deleted middle occurrence and never
  //       returns the deleted id from previousExpenseId/nextExpenseId.
  // ------------------------------------------------------------------------
  it('series navigation skips deleted middle occurrence', async () => {
    const { groupId, participants } = await createGroupWithParticipants(
      `RB-DS6-${runId}`,
      ['Bob'],
    )
    const { expenseIds } = await seedSeriesWithFutureOccurrences({
      groupId,
      participants,
      title: 'Navigation skip',
      initialPaidFor: [
        { participant: participants.Admin, shares: 1 },
        { participant: participants.Bob, shares: 1 },
      ],
    })
    expect(expenseIds.length).toBeGreaterThanOrEqual(3)
    const firstId = expenseIds[0]!
    const middleId = expenseIds[1]!
    const lastId = expenseIds[expenseIds.length - 1]!

    await makeCaller().expenses.delete({
      groupId,
      expenseId: middleId,
      scope: 'OCCURRENCE',
    })

    const firstAfter = await makeCaller().expenses.get({
      groupId,
      expenseId: firstId,
    })
    expect(firstAfter.expense.previousExpenseId).toBeNull()
    expect(firstAfter.expense.nextExpenseId).not.toBe(middleId)
    expect(firstAfter.expense.nextExpenseId).toBe(lastId)

    const lastAfter = await makeCaller().expenses.get({
      groupId,
      expenseId: lastId,
    })
    expect(lastAfter.expense.previousExpenseId).not.toBe(middleId)
    expect(lastAfter.expense.previousExpenseId).toBe(firstId)
    expect(lastAfter.expense.nextExpenseId).toBeNull()
  })
})
