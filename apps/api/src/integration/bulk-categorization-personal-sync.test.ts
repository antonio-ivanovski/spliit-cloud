import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prisma } from '@spliit/db'

import { applyCategorizationRun } from '../lib/api/bulk-categorization-run'
import { personalTarget } from '../lib/api/bulk-categorization-target'
import {
  PersonalInclusionService,
  runPersonalSync,
} from '../lib/personal/inclusion'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

const tag = testRunId()
const accountA = `acct-bulk-sync-a-${tag}`
const accountTitles = `acct-bulk-sync-t-${tag}`
const groupId = `grp-bulk-sync-${tag}`
const ledgerId = `ledger-bulk-sync-${tag}`
const memberAId = `gm-bulk-sync-a-${tag}`
const participantAId = `lp-bulk-sync-a-${tag}`
const expensePlainId = `exp-bulk-sync-plain-${tag}`
const expenseOverrideId = `exp-bulk-sync-override-${tag}`
const runId = `grun-bulk-sync-${tag}`
const validTitleId = `pt-title-valid-${tag}`
const emptyTitleId = `pt-title-empty-${tag}`
const whitespaceTitleId = `pt-title-ws-${tag}`

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

async function createGroupExpense(expenseId: string, title: string) {
  await prisma.expense.create({
    data: {
      id: expenseId,
      ledgerId,
      createdByAccountId: accountA,
      expenseDate: new Date(),
      expenseTimeZone: 'UTC',
      title,
      categoryId: 'general',
      amount: 5000,
      paidBySplitMode: 'BY_AMOUNT',
      splitMode: 'EVENLY',
    },
  })
  await prisma.expensePaidBy.create({
    data: {
      expenseId,
      ledgerParticipantId: participantAId,
      shares: 5000,
    },
  })
  await prisma.expensePaidFor.create({
    data: {
      expenseId,
      ledgerParticipantId: participantAId,
      shares: 1,
    },
  })
}

beforeAll(async () => {
  await prisma.user.createMany({
    data: [
      { id: accountA, email: `${accountA}@test.example`, name: 'Sync A' },
      {
        id: accountTitles,
        email: `${accountTitles}@test.example`,
        name: 'Sync T',
      },
    ],
  })
  await prisma.ledger.create({
    data: { id: ledgerId, currency: '$', currencyCode: 'USD' },
  })
  await prisma.group.create({
    data: { id: groupId, name: 'Sync group', ledgerId },
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
  await createGroupExpense(expensePlainId, 'Plain shared dinner')
  await createGroupExpense(expenseOverrideId, 'Override shared dinner')

  await prisma.personalProfile.upsert({
    where: { accountId: accountA },
    update: { sharedEnabled: true, currencyCode: 'USD', timeZone: 'UTC' },
    create: {
      accountId: accountA,
      currencyCode: 'USD',
      timeZone: 'UTC',
      sharedEnabled: true,
    },
  })
  await prisma.personalGroupRule.upsert({
    where: { accountId_groupId: { accountId: accountA, groupId } },
    update: { included: true },
    create: {
      id: `rule-bulk-sync-${tag}`,
      accountId: accountA,
      groupId,
      included: true,
    },
  })
  // Materialize both linked rows as `general` before the bulk apply.
  await runPersonalSync(
    PersonalInclusionService.use((service) =>
      service.syncGroupMembers(groupId),
    ),
  )

  // Title-filter isolation account: one valid + empty + whitespace-only.
  await prisma.personalProfile.upsert({
    where: { accountId: accountTitles },
    update: { sharedEnabled: true, currencyCode: 'USD', timeZone: 'UTC' },
    create: {
      accountId: accountTitles,
      currencyCode: 'USD',
      timeZone: 'UTC',
      sharedEnabled: true,
    },
  })
  const date = new Date(`${todayIso()}T00:00:00.000Z`)
  await prisma.personalTransaction.createMany({
    data: [
      {
        id: validTitleId,
        accountId: accountTitles,
        kind: 'EXPENSE',
        amount: 1200,
        currencyCode: 'USD',
        date,
        categoryId: 'general',
        title: 'Corner grocery run',
        source: 'PERSONAL',
      },
      {
        id: emptyTitleId,
        accountId: accountTitles,
        kind: 'EXPENSE',
        amount: 400,
        currencyCode: 'USD',
        date,
        categoryId: 'general',
        title: '',
        source: 'PERSONAL',
      },
      {
        id: whitespaceTitleId,
        accountId: accountTitles,
        kind: 'EXPENSE',
        amount: 500,
        currencyCode: 'USD',
        date,
        categoryId: 'general',
        title: '   ',
        source: 'PERSONAL',
      },
    ],
  })
})

afterAll(async () => {
  await prisma.bulkCategorizationRow.deleteMany({ where: { runId } })
  await prisma.bulkCategorizationRun.deleteMany({ where: { id: runId } })
  await prisma.personalExpenseOverride.deleteMany({
    where: { accountId: accountA },
  })
  await prisma.personalTransaction.deleteMany({
    where: { accountId: { in: [accountA, accountTitles] } },
  })
  await prisma.personalGroupRule.deleteMany({ where: { accountId: accountA } })
  await prisma.personalProfile.deleteMany({
    where: { accountId: { in: [accountA, accountTitles] } },
  })
  await prisma.expensePaidBy.deleteMany({
    where: { expenseId: { in: [expensePlainId, expenseOverrideId] } },
  })
  await prisma.expensePaidFor.deleteMany({
    where: { expenseId: { in: [expensePlainId, expenseOverrideId] } },
  })
  await prisma.expense.deleteMany({
    where: { id: { in: [expensePlainId, expenseOverrideId] } },
  })
  await prisma.ledgerParticipant.deleteMany({ where: { id: participantAId } })
  await prisma.groupMember.deleteMany({ where: { id: memberAId } })
  await prisma.group.deleteMany({ where: { id: groupId } })
  await prisma.ledger.deleteMany({ where: { id: ledgerId } })
  await prisma.user.deleteMany({
    where: { id: { in: [accountA, accountTitles] } },
  })
})

describe('group bulk-apply personal sync — real DB', () => {
  it('propagates group categories to linked rows; overrides still win', async () => {
    const linkedBefore = await prisma.personalTransaction.findMany({
      where: { accountId: accountA, sourceExpenseId: { not: null } },
    })
    expect(linkedBefore).toHaveLength(2)
    for (const row of linkedBefore) expect(row.categoryId).toBe('general')

    // A personal category override on the second expense must survive the
    // group bulk-apply (override wins over the new source category).
    await prisma.personalExpenseOverride.create({
      data: {
        id: `override-bulk-sync-${tag}`,
        accountId: accountA,
        expenseId: expenseOverrideId,
        categoryId: 'taxi',
      },
    })

    await prisma.bulkCategorizationRun.create({
      data: {
        id: runId,
        scopeType: 'GROUP',
        scopeId: groupId,
        groupId,
        accountId: accountA,
        mode: 'local',
        locale: 'en-US',
        status: 'REVIEW',
        total: 2,
        candidateTotal: 2,
        revision: 0,
        calibration: {},
        examples: {},
      },
    })
    await prisma.bulkCategorizationRow.createMany({
      data: [
        {
          runId,
          itemType: 'EXPENSE',
          itemId: expensePlainId,
          position: 0,
          title: 'Plain shared dinner',
          expenseVersion: 1,
          expenseDate: new Date(),
          amount: 5000,
          currency: 'USD',
          stage: 'SUGGESTED',
          categoryId: 'groceries',
        },
        {
          runId,
          itemType: 'EXPENSE',
          itemId: expenseOverrideId,
          position: 1,
          title: 'Override shared dinner',
          expenseVersion: 1,
          expenseDate: new Date(),
          amount: 5000,
          currency: 'USD',
          stage: 'SUGGESTED',
          categoryId: 'groceries',
        },
      ],
    })

    const result = await applyCategorizationRun(runId, 0, accountA)
    expect(result.applied).toBe(2)

    const plainExpense = await prisma.expense.findUniqueOrThrow({
      where: { id: expensePlainId },
    })
    const overrideExpense = await prisma.expense.findUniqueOrThrow({
      where: { id: expenseOverrideId },
    })
    expect(plainExpense.categoryId).toBe('groceries')
    expect(overrideExpense.categoryId).toBe('groceries')

    const plainLinked = await prisma.personalTransaction.findFirstOrThrow({
      where: { accountId: accountA, sourceExpenseId: expensePlainId },
    })
    expect(plainLinked.categoryId).toBe('groceries')

    const overrideLinked = await prisma.personalTransaction.findFirstOrThrow({
      where: { accountId: accountA, sourceExpenseId: expenseOverrideId },
    })
    expect(overrideLinked.categoryId).toBe('taxi')
  }, 60_000)

  it('excludes empty and whitespace titles from count and capture', async () => {
    const target = personalTarget(accountTitles)
    const count = await target.countUncategorized()
    expect(count).toBe(1)

    const { count: capturedCount, candidates } =
      await target.captureCandidates()
    expect(capturedCount).toBe(1)
    expect(candidates.map((row) => row.id)).toEqual([validTitleId])
    expect(candidates.find((row) => row.id === emptyTitleId)).toBeUndefined()
    expect(
      candidates.find((row) => row.id === whitespaceTitleId),
    ).toBeUndefined()

    const omitted = Math.max(0, capturedCount - candidates.length)
    expect(count).toBe(candidates.length + omitted)
  })
})
