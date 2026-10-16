import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prisma } from '@spliit/db'

import { randomId } from '../lib/api'
import { groupsRouter } from '../trpc/routers/groups'
import {
  checkDbConnection,
  initializeTestAccountTimeZone,
  testRunId,
} from './setup'

await checkDbConnection()

/**
 * Group currency-swap integration tests against a real PostgreSQL DB.
 * Custom-rate mode is fully deterministic (no FX provider calls).
 */
describe('Currency swap — real DB', () => {
  const runId = testRunId()
  const adminId = `acct-swap-${runId}`
  const adminEmail = `swap-${runId}@test.example`

  const ledgerIds: string[] = []
  const accountIds: string[] = []

  function makeCaller(accountId = adminId, email = adminEmail) {
    return groupsRouter.createCaller({
      auth: {
        session: { id: 'sess-test' },
        user: { id: accountId, email, emailVerified: true, name: 'Swap Admin' },
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
        name: 'Swap Admin',
      },
    })
    await initializeTestAccountTimeZone(adminId)
    accountIds.push(adminId)
  })

  afterAll(async () => {
    for (const lid of ledgerIds) {
      await prisma.ledger.delete({ where: { id: lid } }).catch(() => {})
    }
    for (const aid of accountIds) {
      await prisma.user.delete({ where: { id: aid } }).catch(() => {})
    }
  })

  async function createEurGroup() {
    const { groupId } = await makeCaller().create({
      requestId: crypto.randomUUID(),
      groupFormValues: {
        name: `Swap ${runId}`,
        currency: '€',
        currencyCode: 'EUR',
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
    ledgerIds.push(ledgerId)
    const adminLp = group!.members[0].ledgerParticipant!.id
    const alice = await prisma.ledgerParticipant.create({
      data: {
        id: randomId(),
        ledgerId,
        kind: 'UNLINKED_PARTICIPANT',
        displayName: 'Alice',
      },
    })
    return { groupId, ledgerId, adminLp, aliceLp: alice.id }
  }

  it('previews simple + bridged rows with a custom rate', async () => {
    const { groupId, adminLp, aliceLp } = await createEurGroup()
    const caller = makeCaller()
    await caller.expenses.create({
      requestId: crypto.randomUUID(),
      groupId,
      expense: {
        title: 'Berlin dinner',
        amount: 10000,
        expenseDate: new Date('2024-05-01T12:00:00Z').toISOString(),
        expenseTimeZone: 'UTC',
        category: 'general',
        splitMode: 'BY_AMOUNT',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [{ participant: adminLp, shares: 10000 }],
        paidFor: [
          { participant: adminLp, shares: 6000 },
          { participant: aliceLp, shares: 4000 },
        ],
        documents: [],
        recurrenceRule: 'NONE',
      },
    })
    await caller.expenses.create({
      requestId: crypto.randomUUID(),
      groupId,
      expense: {
        title: 'NYC lunch',
        amount: 12000,
        expenseDate: new Date('2024-05-02T12:00:00Z').toISOString(),
        expenseTimeZone: 'UTC',
        category: 'general',
        splitMode: 'BY_AMOUNT',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [{ participant: adminLp, shares: 12000 }],
        paidFor: [
          { participant: adminLp, shares: 7000 },
          { participant: aliceLp, shares: 5000 },
        ],
        conversion: { type: 'custom', currency: 'USD', rate: 0.9 },
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    const pairs = await caller.swapPairs({
      groupId,
      targetCurrencyCode: 'GBP',
    })
    expect(pairs.oldCode).toBe('EUR')
    expect(pairs.newCode).toBe('GBP')
    expect(pairs.expenseCount).toBe(2)
    expect(pairs.pairs).toEqual([
      {
        base: 'EUR',
        target: 'GBP',
        dates: ['2024-05-01', '2024-05-02'],
        expenseCount: 2,
      },
    ])

    const preview = await caller.swapPreview({
      groupId,
      targetCurrencyCode: 'GBP',
      modes: {
        'EUR|GBP': {
          mode: 'fixed',
          date: '2024-06-02',
          override: 0.85,
        },
      },
    })
    expect(preview.oldCode).toBe('EUR')
    expect(preview.newCode).toBe('GBP')
    expect(preview.expenseCount).toBe(2)
    expect(preview.missingRateCount).toBe(0)
    const byTitle = new Map(preview.rows.map((r) => [r.title, r]))
    expect(byTitle.get('Berlin dinner')!.kind).toBe('simple')
    expect(byTitle.get('Berlin dinner')!.newAmount).toBe(8500)
    // Bridged: 0.9 * 0.85 = 0.765 → 12000 * 0.765 = 9180.
    const bridged = byTitle.get('NYC lunch')!
    expect(bridged.kind).toBe('bridged')
    expect(bridged.newAmount).toBe(9180)
    expect(bridged.newConversionSource).toBe('CUSTOM')
    expect(preview.sumOld).toBe(10000 + 10800)
    expect(preview.sumNew).toBe(8500 + 9180)
  })

  it('scopes the preview to a single pair with pairBase', async () => {
    const { groupId, adminLp, aliceLp } = await createEurGroup()
    const caller = makeCaller()
    await caller.expenses.create({
      requestId: crypto.randomUUID(),
      groupId,
      expense: {
        title: 'Berlin dinner',
        amount: 10000,
        expenseDate: new Date('2024-05-01T12:00:00Z').toISOString(),
        expenseTimeZone: 'UTC',
        category: 'general',
        splitMode: 'BY_AMOUNT',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [{ participant: adminLp, shares: 10000 }],
        paidFor: [
          { participant: adminLp, shares: 6000 },
          { participant: aliceLp, shares: 4000 },
        ],
        documents: [],
        recurrenceRule: 'NONE',
      },
    })
    const modes = {
      'EUR|GBP': {
        mode: 'fixed',
        date: '2024-06-02',
        override: 0.85,
      },
    } as const

    const scoped = await caller.swapPreview({
      groupId,
      targetCurrencyCode: 'GBP',
      modes,
      pairBase: 'EUR',
    })
    expect(scoped.expenseCount).toBe(1)
    expect(scoped.rows).toHaveLength(1)
    expect(scoped.missingRateCount).toBe(0)
    expect(scoped.sumOld).toBe(10000)
    expect(scoped.sumNew).toBe(8500)

    const empty = await caller.swapPreview({
      groupId,
      targetCurrencyCode: 'GBP',
      modes,
      pairBase: 'USD',
    })
    expect(empty.expenseCount).toBe(0)
    expect(empty.rows).toHaveLength(0)
    expect(empty.missingRateCount).toBe(0)
    expect(empty.sumOld).toBe(0)
    expect(empty.sumNew).toBe(0)
  })

  it('executes the swap and rewrites ledger amounts + simple splits', async () => {
    const { groupId, ledgerId, adminLp, aliceLp } = await createEurGroup()
    const caller = makeCaller()
    await caller.expenses.create({
      requestId: crypto.randomUUID(),
      groupId,
      expense: {
        title: 'Berlin dinner',
        amount: 10000,
        expenseDate: new Date('2024-05-01T12:00:00Z').toISOString(),
        expenseTimeZone: 'UTC',
        category: 'general',
        splitMode: 'BY_AMOUNT',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [{ participant: adminLp, shares: 10000 }],
        paidFor: [
          { participant: adminLp, shares: 6000 },
          { participant: aliceLp, shares: 4000 },
        ],
        documents: [],
        recurrenceRule: 'NONE',
      },
    })
    const { expenseId } = await caller.expenses.create({
      requestId: crypto.randomUUID(),
      groupId,
      expense: {
        title: 'NYC lunch',
        amount: 12000,
        expenseDate: new Date('2024-05-02T12:00:00Z').toISOString(),
        expenseTimeZone: 'UTC',
        category: 'general',
        splitMode: 'BY_AMOUNT',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [{ participant: adminLp, shares: 12000 }],
        paidFor: [
          { participant: adminLp, shares: 7000 },
          { participant: aliceLp, shares: 5000 },
        ],
        conversion: { type: 'custom', currency: 'USD', rate: 0.9 },
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    const result = await caller.swapExecute({
      groupId,
      targetCurrencyCode: 'GBP',
      modes: {
        'EUR|GBP': {
          mode: 'fixed',
          date: '2024-06-02',
          override: 0.85,
        },
      },
    })
    expect(result).toEqual({
      updated: 2,
      newCode: 'GBP',
      seriesTemplatesConverted: 0,
    })

    const ledger = await prisma.ledger.findUniqueOrThrow({
      where: { id: ledgerId },
    })
    expect(ledger.currencyCode).toBe('GBP')
    expect(ledger.currency).toBe('£')

    const simple = await prisma.expense.findFirstOrThrow({
      where: { ledgerId, title: 'Berlin dinner' },
      include: { paidFor: true, paidByList: true },
    })
    expect(simple.amount).toBe(8500)
    expect(simple.conversionSource).toBeNull()
    expect(
      simple.paidFor.find((p) => p.ledgerParticipantId === adminLp)?.shares,
    ).toBe(5100)
    expect(
      simple.paidFor.find((p) => p.ledgerParticipantId === aliceLp)?.shares,
    ).toBe(3400)
    expect(simple.paidByList[0]?.shares).toBe(8500)
    expect(simple.version).toBe(2)

    const converted = await prisma.expense.findUniqueOrThrow({
      where: { id: expenseId },
      include: { paidFor: true },
    })
    expect(converted.amount).toBe(9180)
    expect(converted.originalCurrency).toBe('USD')
    expect(converted.originalAmount).toBe(12000)
    expect(converted.conversionSource).toBe('CUSTOM')
    // BY_AMOUNT shares stay in original-currency minor units (untouched).
    expect(
      converted.paidFor.find((p) => p.ledgerParticipantId === adminLp)?.shares,
    ).toBe(7000)
    expect(
      converted.paidFor.find((p) => p.ledgerParticipantId === aliceLp)?.shares,
    ).toBe(5000)
  })

  it('converts recurring templates at the pair override (all statuses)', async () => {
    const { groupId, ledgerId, adminLp } = await createEurGroup()
    const caller = makeCaller()
    const pastDate = new Date()
    pastDate.setUTCDate(pastDate.getUTCDate() - 14)
    async function makeSeries(title: string) {
      const created = await caller.expenses.create({
        requestId: crypto.randomUUID(),
        groupId,
        expense: {
          title,
          amount: 10000,
          expenseDate: pastDate.toISOString(),
          expenseTimeZone: 'UTC',
          category: 'general',
          splitMode: 'BY_AMOUNT',
          paidBySplitMode: 'BY_AMOUNT',
          paidByList: [{ participant: adminLp, shares: 10000 }],
          paidFor: [{ participant: adminLp, shares: 10000 }],
          documents: [],
          recurrenceRule: 'WEEKLY',
        },
      })
      return created.recurringSeriesId!
    }
    const activeId = await makeSeries('Weekly rent active')
    const pausedId = await makeSeries('Weekly rent paused')
    const completedId = await makeSeries('Weekly rent completed')
    const cancelledId = await makeSeries('Weekly rent cancelled')
    const { stopRecurrence } =
      await import('../lib/api/expenses/stop-recurrence')
    await prisma.recurringExpenseSeries.update({
      where: { id: pausedId },
      data: { status: 'PAUSED', templateVersion: { increment: 1 } },
    })
    await prisma.recurringExpenseSeries.update({
      where: { id: completedId },
      data: { status: 'COMPLETED', templateVersion: { increment: 1 } },
    })
    const anchor = await prisma.expense.findFirstOrThrow({
      where: { recurringSeriesId: cancelledId },
      select: { id: true },
    })
    await stopRecurrence(groupId, anchor.id, { accountId: adminId })
    const seriesId = activeId
    const before = await prisma.recurringExpenseSeries.findUniqueOrThrow({
      where: { id: seriesId },
    })
    expect(before.status).toBe('ACTIVE')
    const templateBefore = before.template as unknown as { amount: number }
    expect(templateBefore.amount).toBe(10000)

    const preview = await caller.swapPreview({
      groupId,
      targetCurrencyCode: 'GBP',
      modes: {
        'EUR|GBP': { mode: 'fixed', date: '2024-06-02', override: 0.85 },
      },
    })
    expect(preview.seriesTemplateCount).toBe(4)
    expect(preview.warnings).toContain('series-templates-convert')

    const result = await caller.swapExecute({
      groupId,
      targetCurrencyCode: 'GBP',
      modes: {
        'EUR|GBP': { mode: 'fixed', date: '2024-06-02', override: 0.85 },
      },
    })
    expect(result.seriesTemplatesConverted).toBe(4)

    const after = await prisma.recurringExpenseSeries.findUniqueOrThrow({
      where: { id: seriesId },
    })
    const templateAfter = after.template as unknown as {
      amount: number
      paidFor: Array<{ shares: number }>
    }
    // 10000 * 0.85 with EUR->GBP minor-unit scaling.
    expect(templateAfter.amount).toBe(8500)
    expect(templateAfter.paidFor[0]!.shares).toBe(8500)
    expect(after.templateVersion).toBe(before.templateVersion + 1)
    expect(after.status).toBe('ACTIVE')
    // Terminal + paused templates convert too, without touching scheduling.
    for (const id of [pausedId, completedId, cancelledId]) {
      const converted = await prisma.recurringExpenseSeries.findUniqueOrThrow({
        where: { id },
      })
      const convertedTemplate = converted.template as unknown as {
        amount: number
      }
      expect(convertedTemplate.amount).toBe(8500)
      expect(converted.templateVersion).toBeGreaterThan(1)
    }
    const pausedAfter = await prisma.recurringExpenseSeries.findUniqueOrThrow({
      where: { id: pausedId },
    })
    expect(pausedAfter.status).toBe('PAUSED')
    const completedAfter =
      await prisma.recurringExpenseSeries.findUniqueOrThrow({
        where: { id: completedId },
      })
    expect(completedAfter.status).toBe('COMPLETED')
    const cancelledAfter =
      await prisma.recurringExpenseSeries.findUniqueOrThrow({
        where: { id: cancelledId },
      })
    expect(cancelledAfter.status).toBe('CANCELLED')

    const activity = await prisma.activity.findFirstOrThrow({
      where: { ledgerId, type: 'GROUP_UPDATED' },
      orderBy: { time: 'desc' },
    })
    const data = activity.data as unknown as {
      currencySwap?: {
        fromCurrencyCode: string
        toCurrencyCode: string
        expensesConverted: number
        seriesTemplatesConverted: number
      }
    }
    expect(data.currencySwap).toEqual({
      fromCurrencyCode: 'EUR',
      toCurrencyCode: 'GBP',
      expensesConverted: result.updated,
      seriesTemplatesConverted: 4,
    })

    // Future occurrences materialize in the new currency from the template.
    const { materializeRecurringExpense } =
      await import('../lib/api/recurrence-series')
    const refreshed = await prisma.recurringExpenseSeries.findUniqueOrThrow({
      where: { id: seriesId },
    })
    if (refreshed.nextOccurrenceDate <= new Date()) {
      const materialized = await materializeRecurringExpense({
        seriesId,
        sequence: refreshed.occurrencesCreated + 1,
        occurrenceDate: refreshed.nextOccurrenceDate.toISOString().slice(0, 10),
      })
      expect(materialized.created).toBe(true)
      const occurrence = await prisma.expense.findUniqueOrThrow({
        where: { id: materialized.expenseId! },
      })
      expect(occurrence.amount).toBe(8500)
    }
  })

  it('rejects non-admin callers', async () => {
    const { groupId, ledgerId } = await createEurGroup()
    const memberId = `acct-swap-member-${runId}`
    const memberEmail = `swap-member-${runId}@test.example`
    await prisma.user.create({
      data: {
        id: memberId,
        email: memberEmail,
        emailVerified: true,
        name: 'Swap Member',
      },
    })
    accountIds.push(memberId)
    await prisma.groupMember.create({
      data: {
        id: randomId(),
        groupId,
        accountId: memberId,
        role: 'MEMBER',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    })
    await expect(
      makeCaller(memberId, memberEmail).swapExecute({
        groupId,
        targetCurrencyCode: 'GBP',
        modes: {},
      }),
    ).rejects.toThrow()
    const ledger = await prisma.ledger.findUniqueOrThrow({
      where: { id: ledgerId },
    })
    expect(ledger.currencyCode).toBe('EUR')
  })
})
