import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { prisma } from '@spliit/db'

import {
  materializePersonalRecurringSeries,
  reconcileDuePersonalRecurringSeries,
} from '../lib/personal/recurring-materialize'
import { personalRouter } from '../trpc/routers/personal'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

const runId = testRunId()
const ownerId = `acct-personal-rec-owner-${runId}`
const otherId = `acct-personal-rec-other-${runId}`

function caller(accountId: string) {
  return personalRouter.createCaller({
    auth: {
      session: { id: 'sess-personal-rec' },
      user: {
        id: accountId,
        email: `${accountId}@test.example`,
        emailVerified: true,
        name: accountId,
      },
    },
  } as never)
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function pastIso(days: number) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

beforeAll(async () => {
  for (const [id, name] of [
    [ownerId, 'Rec Owner'],
    [otherId, 'Rec Other'],
  ]) {
    await prisma.user.create({
      data: { id, email: `${id}@test.example`, name, emailVerified: true },
    })
  }
})

afterAll(async () => {
  await prisma.personalTransaction.deleteMany({
    where: { accountId: { in: [ownerId, otherId] } },
  })
  await prisma.personalRecurringSeries.deleteMany({
    where: { accountId: { in: [ownerId, otherId] } },
  })
  await prisma.personalProfile.deleteMany({
    where: { accountId: { in: [ownerId, otherId] } },
  })
  await prisma.user.deleteMany({
    where: { id: { in: [ownerId, otherId] } },
  })
})

describe('personal recurring — real DB', () => {
  it('creates a past-due series and materializes it with link and sequence', async () => {
    const owner = caller(ownerId)
    await owner.profile.get()

    const created = await owner.recurring.create({
      requestId: crypto.randomUUID(),
      series: {
        frequency: 'DAILY',
        interval: 1,
        anchorDate: pastIso(2),
        end: { type: 'INDEFINITE' },
        kind: 'EXPENSE',
        amount: 150,
        categoryId: 'groceries',
        title: 'Milk',
      },
    })

    const upcoming = await owner.recurring.upcoming({ limit: 3 })
    expect(upcoming.occurrences.length).toBeGreaterThan(0)
    expect(upcoming.occurrences[0]).toMatchObject({ seriesId: created.id })

    const first = await materializePersonalRecurringSeries({
      seriesId: created.id,
      sequence: 1,
      occurrenceDate: pastIso(2),
    })
    expect(first.created).toBe(true)

    const row = await prisma.personalTransaction.findFirstOrThrow({
      where: { accountId: ownerId, personalRecurringSeriesId: created.id },
    })
    expect(row).toMatchObject({
      recurrenceSequence: 1,
      source: 'PERSONAL',
      amount: 150,
    })
    expect(row.date.toISOString().slice(0, 10)).toBe(pastIso(2))

    // Duplicate delivery is a no-op.
    const dup = await materializePersonalRecurringSeries({
      seriesId: created.id,
      sequence: 1,
      occurrenceDate: pastIso(2),
    })
    expect(dup.created).toBe(false)
    expect(
      await prisma.personalTransaction.count({
        where: { accountId: ownerId, personalRecurringSeriesId: created.id },
      }),
    ).toBe(1)

    const listed = await owner.transactions.list({ limit: 10 })
    expect(
      listed.entries.find((entry) => entry.id === row.id)?.recurring,
    ).toMatchObject({ seriesId: created.id, sequence: 1 })

    // Account isolation: the other account cannot see or touch the series.
    const other = caller(otherId)
    await other.profile.get()
    expect((await other.recurring.list()).series).toHaveLength(0)
    await expect(
      other.recurring.update({ id: created.id, patch: { amount: 200 } }),
    ).rejects.toThrow()
    await expect(
      materializePersonalRecurringSeries({
        seriesId: created.id,
        sequence: 999,
        occurrenceDate: todayIso(),
      }),
    ).resolves.toMatchObject({ created: false })

    // Pause skips the backlog on resume without backfilling.
    await owner.recurring.pause({ id: created.id })
    const resumed = await owner.recurring.resume({ id: created.id })
    expect(resumed.skipped).toBeGreaterThanOrEqual(1)
    const afterResume = await prisma.personalRecurringSeries.findUniqueOrThrow({
      where: { id: created.id },
    })
    expect(afterResume.status).toBe('ACTIVE')
    expect(afterResume.nextOccurrenceDate.toISOString().slice(0, 10)).toBe(
      todayIso(),
    )
    // No backfill rows were created by resume.
    expect(
      await prisma.personalTransaction.count({
        where: { accountId: ownerId, personalRecurringSeriesId: created.id },
      }),
    ).toBe(1)

    // Cancel keeps history rows.
    await owner.recurring.cancel({ id: created.id })
    expect(
      await prisma.personalTransaction.count({
        where: { accountId: ownerId, personalRecurringSeriesId: created.id },
      }),
    ).toBe(1)
    const cancelled = await materializePersonalRecurringSeries({
      seriesId: created.id,
      sequence: 2,
      occurrenceDate: todayIso(),
    })
    expect(cancelled.created).toBe(false)
  })

  it('counts materialized rows, not slots, for COUNT ends', async () => {
    const owner = caller(ownerId)
    await owner.profile.get()
    const created = await owner.recurring.create({
      requestId: crypto.randomUUID(),
      series: {
        frequency: 'DAILY',
        interval: 1,
        anchorDate: pastIso(2),
        end: { type: 'COUNT', count: 2 },
        kind: 'EXPENSE',
        amount: 100,
        categoryId: 'general',
        title: 'Counted',
      },
    })
    // Skip one slot: the ordinal advances without consuming COUNT budget.
    const skipped = await owner.recurring.skipNext({ id: created.id })
    expect(skipped.id).toBe(created.id)
    const afterSkip = await prisma.personalRecurringSeries.findUniqueOrThrow({
      where: { id: created.id },
    })
    expect(afterSkip.nextOccurrenceOrdinal).toBe(2)
    expect(afterSkip.occurrencesCreated).toBe(0)
    expect(afterSkip.status).toBe('ACTIVE')

    // Slots after one skip: ordinal 2 is yesterday, ordinal 3 is today.
    const slot2Iso = pastIso(1)
    const slot3Iso = todayIso()

    // First materialized row uses the slot ordinal (2), not created+1.
    const staleSequence = await materializePersonalRecurringSeries({
      seriesId: created.id,
      sequence: 1,
      occurrenceDate: pastIso(2),
    })
    expect(staleSequence.created).toBe(false)

    const first = await materializePersonalRecurringSeries({
      seriesId: created.id,
      sequence: 2,
      occurrenceDate: slot2Iso,
    })
    expect(first.created).toBe(true)
    const second = await materializePersonalRecurringSeries({
      seriesId: created.id,
      sequence: 3,
      occurrenceDate: slot3Iso,
    })
    // Second row completes the COUNT=2 budget even though slots ran to 3.
    expect(second.created).toBe(true)
    expect(
      await prisma.personalTransaction.count({
        where: { accountId: ownerId, personalRecurringSeriesId: created.id },
      }),
    ).toBe(2)
    const done = await prisma.personalRecurringSeries.findUniqueOrThrow({
      where: { id: created.id },
    })
    expect(done.status).toBe('COMPLETED')
    expect(done.occurrencesCreated).toBe(2)

    // A third materialization is a no-op and keeps the series COMPLETED.
    const third = await materializePersonalRecurringSeries({
      seriesId: created.id,
      sequence: 4,
      occurrenceDate: todayIso(),
    })
    expect(third.created).toBe(false)
    expect(
      await prisma.personalRecurringSeries.findUniqueOrThrow({
        where: { id: created.id },
      }),
    ).toMatchObject({ status: 'COMPLETED', occurrencesCreated: 2 })
  })

  it('skips twice, resumes without backfill, and completes on shrink', async () => {
    const owner = caller(ownerId)
    await owner.profile.get()
    const created = await owner.recurring.create({
      requestId: crypto.randomUUID(),
      series: {
        frequency: 'DAILY',
        interval: 1,
        anchorDate: pastIso(5),
        end: { type: 'INDEFINITE' },
        kind: 'EXPENSE',
        amount: 75,
        categoryId: 'general',
        title: 'Skip resume',
      },
    })
    await owner.recurring.skipNext({ id: created.id })
    await owner.recurring.skipNext({ id: created.id })
    const afterSkips = await prisma.personalRecurringSeries.findUniqueOrThrow({
      where: { id: created.id },
    })
    expect(afterSkips.nextOccurrenceOrdinal).toBe(3)
    expect(afterSkips.occurrencesCreated).toBe(0)

    await owner.recurring.pause({ id: created.id })
    const resumed = await owner.recurring.resume({ id: created.id })
    // Resume fast-forwards the 5-day-old cursor to today without creating rows.
    expect(resumed.skipped).toBeGreaterThanOrEqual(1)
    const afterResume = await prisma.personalRecurringSeries.findUniqueOrThrow({
      where: { id: created.id },
    })
    expect(afterResume.status).toBe('ACTIVE')
    expect(afterResume.nextOccurrenceDate.toISOString().slice(0, 10)).toBe(
      todayIso(),
    )
    expect(afterResume.occurrencesCreated).toBe(0)
    expect(
      await prisma.personalTransaction.count({
        where: { accountId: ownerId, personalRecurringSeriesId: created.id },
      }),
    ).toBe(0)

    // Shrinking COUNT to the created count completes with no future rows.
    const counted = await owner.recurring.create({
      requestId: crypto.randomUUID(),
      series: {
        frequency: 'DAILY',
        interval: 1,
        anchorDate: pastIso(0),
        end: { type: 'COUNT', count: 3 },
        kind: 'EXPENSE',
        amount: 50,
        categoryId: 'general',
        title: 'Shrink',
      },
    })
    const mat = await materializePersonalRecurringSeries({
      seriesId: counted.id,
      sequence: 1,
      occurrenceDate: todayIso(),
    })
    expect(mat.created).toBe(true)
    await owner.recurring.update({
      id: counted.id,
      patch: { end: { type: 'COUNT', count: 1 } },
    })
    const shrunk = await prisma.personalRecurringSeries.findUniqueOrThrow({
      where: { id: counted.id },
    })
    expect(shrunk).toMatchObject({
      status: 'COMPLETED',
      occurrenceLimit: 1,
      occurrencesCreated: 1,
    })
  })

  it('reconciles a due series by enqueueing materialization', async () => {
    const owner = caller(ownerId)
    const created = await owner.recurring.create({
      requestId: crypto.randomUUID(),
      series: {
        frequency: 'DAILY',
        interval: 1,
        anchorDate: pastIso(1),
        end: { type: 'INDEFINITE' },
        kind: 'INCOME',
        amount: 2000,
        categoryId: 'income',
        title: 'Pay',
      },
    })
    const sends: Array<{ name: string; payload: unknown }> = []
    const fakeBoss = {
      send: vi.fn(async (name: string, payload: unknown) => {
        sends.push({ name, payload })
        return 'job-1'
      }),
      findJobs: vi.fn(async () => []),
    }
    const result = await reconcileDuePersonalRecurringSeries(
      fakeBoss as never,
      {},
    )
    expect(result.scanned).toBeGreaterThanOrEqual(1)
    const mine = sends.find(
      (send) => (send.payload as { seriesId?: string }).seriesId === created.id,
    )
    expect(mine?.name).toBe('personal-recurring.materialize')

    // The reconcile cursor pages without throwing on empty tails.
    const second = await reconcileDuePersonalRecurringSeries(
      fakeBoss as never,
      { cursor: created.id },
    )
    expect(second.scanned).toBeGreaterThanOrEqual(0)
  })
})
