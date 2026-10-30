import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { prisma } from '@spliit/db'
import { env as jobsEnv } from '@spliit/jobs'
import type * as JobsModule from '@spliit/jobs'

import type * as BossModule from '../lib/api/boss'
import { processCategorizationJob } from '../lib/api/bulk-categorization-run'
import { personalRouter } from '../trpc/routers/personal'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

vi.mock('../lib/api/boss', async (importOriginal) => {
  const mod = await importOriginal<BossModule>()
  return { ...mod, getApiBossForWrite: vi.fn(async () => ({}) as never) }
})
vi.mock('@spliit/jobs', async (importOriginal) => {
  const mod = await importOriginal<JobsModule>()
  return { ...mod, sendJob: vi.fn(async () => 'job-test') }
})

const tag = testRunId()
const accountA = `acct-personal-cat-a-${tag}`
const accountB = `acct-personal-cat-b-${tag}`
const groupId = `grp-personal-cat-${tag}`
const ledgerId = `ledger-personal-cat-${tag}`
const memberAId = `gm-personal-cat-a-${tag}`
const participantAId = `lp-personal-cat-a-${tag}`
const groupExpenseId = `exp-personal-cat-live-${tag}`
const groupRunId = `grun-personal-cat-${tag}`

function caller(accountId: string) {
  return personalRouter.createCaller({
    auth: {
      session: { id: 'sess-personal-cat' },
      user: {
        id: accountId,
        email: `${accountId}@test.example`,
        emailVerified: true,
        name: accountId,
      },
    },
    resHeaders: new Headers(),
  } as never)
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

beforeAll(async () => {
  for (const [id, name] of [
    [accountA, 'Cat A'],
    [accountB, 'Cat B'],
  ]) {
    await prisma.user.create({
      data: { id, email: `${id}@test.example`, name, emailVerified: true },
    })
  }
  await prisma.ledger.create({
    data: { id: ledgerId, currency: '$', currencyCode: 'USD' },
  })
  await prisma.group.create({
    data: { id: groupId, name: 'Cat group', ledgerId },
  })
  await prisma.groupMember.create({
    data: {
      id: memberAId,
      groupId,
      accountId: accountA,
      role: 'ADMIN',
      status: 'ACTIVE',
      joinedAt: new Date(),
    },
  })
  await prisma.ledgerParticipant.create({
    data: { id: participantAId, ledgerId, groupMemberId: memberAId },
  })
  await prisma.expense.create({
    data: {
      id: groupExpenseId,
      ledgerId,
      createdByAccountId: accountA,
      expenseDate: new Date(),
      expenseTimeZone: 'UTC',
      title: 'Group dinner share',
      categoryId: 'general',
      amount: 5000,
      paidBySplitMode: 'BY_AMOUNT',
      splitMode: 'EVENLY',
    },
  })
  await prisma.expensePaidBy.create({
    data: {
      expenseId: groupExpenseId,
      ledgerParticipantId: participantAId,
      shares: 5000,
    },
  })
  await prisma.expensePaidFor.create({
    data: {
      expenseId: groupExpenseId,
      ledgerParticipantId: participantAId,
      shares: 1,
    },
  })

  // Seed personal rows for account A: native + live GROUP + detached snapshot.
  const profile = await caller(accountA).profile.get()
  expect(profile.currencyCode).toBeTruthy()
  await caller(accountA).profile.update({ sharedEnabled: true })
  await prisma.personalTransaction.createMany({
    data: [
      {
        id: `pt-native-${tag}`,
        accountId: accountA,
        kind: 'EXPENSE',
        amount: 1200,
        currencyCode: 'USD',
        date: new Date(`${todayIso()}T00:00:00.000Z`),
        categoryId: 'general',
        title: 'Corner grocery run',
      },
      {
        id: `pt-live-${tag}`,
        accountId: accountA,
        kind: 'EXPENSE',
        amount: 2500,
        currencyCode: 'USD',
        date: new Date(`${todayIso()}T00:00:00.000Z`),
        categoryId: 'general',
        title: 'Group dinner share',
        source: 'GROUP',
        sourceExpenseId: groupExpenseId,
        sourceGroupId: groupId,
        sourceGroupName: 'Cat group',
      },
      {
        id: `pt-detached-${tag}`,
        accountId: accountA,
        kind: 'EXPENSE',
        amount: 800,
        currencyCode: 'USD',
        date: new Date(`${todayIso()}T00:00:00.000Z`),
        categoryId: 'general',
        title: 'Old shared taxi',
        source: 'GROUP',
        sourceExpenseId: `exp-detached-${tag}`,
        sourceGroupId: groupId,
        sourceGroupName: 'Cat group',
        sourceDetachedAt: new Date(),
      },
    ],
  })

  // A pre-existing GROUP bulk run (untouched by the personal apply).
  await prisma.bulkCategorizationRun.create({
    data: {
      id: groupRunId,
      scopeType: 'GROUP',
      scopeId: groupId,
      groupId,
      accountId: accountA,
      mode: 'local',
      locale: 'en-US',
      status: 'REVIEW',
      total: 1,
      candidateTotal: 1,
      revision: 0,
      calibration: {},
      examples: {},
    },
  })
  await prisma.bulkCategorizationRow.create({
    data: {
      runId: groupRunId,
      itemType: 'EXPENSE',
      itemId: groupExpenseId,
      position: 0,
      title: 'Group dinner share',
      expenseVersion: 1,
      expenseDate: new Date(),
      amount: 5000,
      currency: 'USD',
      stage: 'SUGGESTED',
      categoryId: 'groceries',
    },
  })
})

afterAll(async () => {
  await prisma.bulkCategorizationRow.deleteMany({
    where: { runId: { in: [groupRunId] } },
  })
  await prisma.bulkCategorizationRun.deleteMany({
    where: { id: { in: [groupRunId] } },
  })
  // Personal runs cascade via personalAccountId; delete explicitly for isolation.
  const runs = await prisma.bulkCategorizationRun.findMany({
    where: { scopeType: 'PERSONAL', scopeId: accountA },
    select: { id: true },
  })
  for (const run of runs) {
    await prisma.bulkCategorizationRow.deleteMany({ where: { runId: run.id } })
  }
  await prisma.bulkCategorizationRun.deleteMany({
    where: { scopeType: 'PERSONAL', scopeId: accountA },
  })
  await prisma.personalTransaction.deleteMany({
    where: { accountId: { in: [accountA, accountB] } },
  })
  await prisma.personalProfile.deleteMany({
    where: { accountId: { in: [accountA, accountB] } },
  })
  await prisma.personalExpenseOverride.deleteMany({
    where: { accountId: accountA },
  })
  await prisma.expensePaidBy.deleteMany({
    where: { expenseId: groupExpenseId },
  })
  await prisma.expensePaidFor.deleteMany({
    where: { expenseId: groupExpenseId },
  })
  await prisma.expense.deleteMany({ where: { id: groupExpenseId } })
  await prisma.ledgerParticipant.deleteMany({ where: { id: participantAId } })
  await prisma.groupMember.deleteMany({ where: { id: memberAId } })
  await prisma.group.deleteMany({ where: { id: groupId } })
  await prisma.ledger.deleteMany({ where: { id: ledgerId } })
  await prisma.user.deleteMany({ where: { id: { in: [accountA, accountB] } } })
})

describe('personal bulk categorization — real DB', () => {
  it('starts, reviews, applies, and isolates by account', async () => {
    const owner = caller(accountA)
    const other = caller(accountB)

    // Count only sees account A's uncategorized personal rows.
    expect(await owner.categorization.count()).toBe(3)
    expect(await other.categorization.count()).toBe(0)

    const wasJobsEnabled = jobsEnv.JOBS_ENABLED
    jobsEnv.JOBS_ENABLED = true
    let started
    try {
      started = await owner.categorization.start({ mode: 'local' })
    } finally {
      jobsEnv.JOBS_ENABLED = wasJobsEnabled
    }
    expect(started?.scopeType).toBe('PERSONAL')
    expect(started?.scopeId).toBe(accountA)
    const personalRunId = started!.id
    const attemptId = (started as unknown as { reviewCycle: string | null })
      .reviewCycle
    expect(attemptId).toBeTruthy()

    // Drive the deterministic local worker to a reviewable state.
    const runBefore = await prisma.bulkCategorizationRun.findUniqueOrThrow({
      where: { id: personalRunId },
    })
    await processCategorizationJob(
      personalRunId,
      'calibration',
      runBefore.attemptId!,
    )
    const afterCal = await prisma.bulkCategorizationRun.findUniqueOrThrow({
      where: { id: personalRunId },
    })
    expect(afterCal.status).toBe('CALIBRATION_REVIEW')

    // Account B cannot read account A's run (status is null, mutations reject).
    await expect(other.categorization.status()).resolves.toBeNull()
    await expect(
      other.categorization.reviewPage({ runId: personalRunId }),
    ).rejects.toThrow()

    // Confirm calibration, then run the full pass.
    const calRun = await prisma.bulkCategorizationRun.findUniqueOrThrow({
      where: { id: personalRunId },
    })
    await owner.categorization.confirm({
      runId: personalRunId,
      revision: calRun.revision,
    })
    const queued = await prisma.bulkCategorizationRun.findUniqueOrThrow({
      where: { id: personalRunId },
    })
    // Full pass may be QUEUED (calibration confirmed) — process it.
    if (queued.status === 'QUEUED') {
      await processCategorizationJob(personalRunId, 'full', queued.attemptId!)
    }
    const reviewRun = await prisma.bulkCategorizationRun.findUniqueOrThrow({
      where: { id: personalRunId },
    })
    expect(reviewRun.status).toBe('REVIEW')

    // Set explicit categories for all three rows (review).
    const reviewPage = await owner.categorization.reviewPage({
      runId: personalRunId,
    })
    const revision = reviewPage.revision
    await owner.categorization.edit({
      runId: personalRunId,
      revision,
      changes: reviewPage.rows.map((row) => ({
        expenseId: row.id,
        categoryId: 'groceries' as const,
      })),
    })

    const afterEdit = await prisma.bulkCategorizationRun.findUniqueOrThrow({
      where: { id: personalRunId },
    })
    const saved = await owner.categorization.save({
      runId: personalRunId,
      revision: afterEdit.revision,
    })
    expect(saved.applied).toBe(3)

    // Native row updated.
    const native = await prisma.personalTransaction.findUniqueOrThrow({
      where: { id: `pt-native-${tag}` },
    })
    expect(native.categoryId).toBe('groceries')

    // Live GROUP row: personal category + override, group Expense untouched.
    const live = await prisma.personalTransaction.findUniqueOrThrow({
      where: { id: `pt-live-${tag}` },
    })
    expect(live.categoryId).toBe('groceries')
    const override = await prisma.personalExpenseOverride.findUniqueOrThrow({
      where: {
        accountId_expenseId: { accountId: accountA, expenseId: groupExpenseId },
      },
    })
    expect(override.categoryId).toBe('groceries')
    const groupExpense = await prisma.expense.findUniqueOrThrow({
      where: { id: groupExpenseId },
    })
    expect(groupExpense.categoryId).toBe('general')

    // Detached snapshot: row-only update, no override.
    const detached = await prisma.personalTransaction.findUniqueOrThrow({
      where: { id: `pt-detached-${tag}` },
    })
    expect(detached.categoryId).toBe('groceries')
    const detachedOverride = await prisma.personalExpenseOverride.findFirst({
      where: { accountId: accountA, expenseId: `exp-detached-${tag}` },
    })
    expect(detachedOverride).toBeNull()

    // Group run rows untouched.
    const groupRow = await prisma.bulkCategorizationRow.findUniqueOrThrow({
      where: { runId_itemId: { runId: groupRunId, itemId: groupExpenseId } },
    })
    expect(groupRow.categoryId).toBe('groceries')

    // Account B cannot apply account A's run.
    await expect(
      other.categorization.save({
        runId: personalRunId,
        revision: afterEdit.revision,
      }),
    ).rejects.toThrow()
  }, 60_000)
})
