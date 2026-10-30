import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prisma } from '@spliit/db'

import {
  PersonalInclusionService,
  runPersonalSync,
  runPersonalSyncResult,
} from '../lib/personal/inclusion'
import { personalRouter } from '../trpc/routers/personal'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

const runId = testRunId()
const ownerId = `acct-personal-owner-${runId}`
const partnerId = `acct-personal-partner-${runId}`
const pagerId = `acct-personal-pager-${runId}`
const groupId = `grp-personal-${runId}`
const ledgerId = `ledger-personal-${runId}`
const ownerMemberId = `gm-personal-owner-${runId}`
const partnerMemberId = `gm-personal-partner-${runId}`
const ownerParticipantId = `lp-personal-owner-${runId}`
const partnerParticipantId = `lp-personal-partner-${runId}`
const expenseId = `exp-personal-${runId}`

function caller(accountId: string) {
  return personalRouter.createCaller({
    auth: {
      session: { id: 'sess-personal-test' },
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

beforeAll(async () => {
  for (const [id, name] of [
    [ownerId, 'Owner'],
    [partnerId, 'Partner'],
    [pagerId, 'Pager'],
  ]) {
    await prisma.user.create({
      data: {
        id,
        email: `${id}@test.example`,
        name,
        emailVerified: true,
      },
    })
  }

  await prisma.ledger.create({
    data: { id: ledgerId, currency: '$', currencyCode: 'USD' },
  })
  await prisma.group.create({
    data: { id: groupId, name: 'Personal test group', ledgerId },
  })
  await prisma.groupMember.createMany({
    data: [
      {
        id: ownerMemberId,
        groupId,
        accountId: ownerId,
        role: 'ADMIN',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
      {
        id: partnerMemberId,
        groupId,
        accountId: partnerId,
        role: 'MEMBER',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    ],
  })
  await prisma.ledgerParticipant.createMany({
    data: [
      {
        id: ownerParticipantId,
        ledgerId,
        groupMemberId: ownerMemberId,
      },
      {
        id: partnerParticipantId,
        ledgerId,
        groupMemberId: partnerMemberId,
      },
    ],
  })

  await prisma.expense.create({
    data: {
      id: expenseId,
      ledgerId,
      createdByAccountId: ownerId,
      expenseDate: new Date(),
      expenseTimeZone: 'UTC',
      title: 'Dinner',
      categoryId: 'dining-out',
      amount: 10_000,
      paidBySplitMode: 'BY_AMOUNT',
      splitMode: 'EVENLY',
    },
  })
  await prisma.expensePaidBy.create({
    data: {
      expenseId,
      ledgerParticipantId: ownerParticipantId,
      shares: 10_000,
    },
  })
  await prisma.expensePaidFor.createMany({
    data: [
      { expenseId, ledgerParticipantId: ownerParticipantId, shares: 1 },
      { expenseId, ledgerParticipantId: partnerParticipantId, shares: 1 },
    ],
  })
})

afterAll(async () => {
  await prisma.expense.deleteMany({ where: { ledgerId } })
  await prisma.personalTransaction.deleteMany({
    where: { accountId: { in: [ownerId, partnerId] } },
  })
  await prisma.group.deleteMany({ where: { id: groupId } })
  await prisma.ledger.deleteMany({ where: { id: ledgerId } })
  await prisma.user.deleteMany({
    where: { id: { in: [ownerId, partnerId, pagerId] } },
  })
})

describe('personal expenses — real DB', () => {
  it('creates transactions, budgets, and an overview', async () => {
    const owner = caller(ownerId)
    const profile = await owner.profile.get()
    expect(profile.currencyCode).toBe('USD')
    expect(profile.sharedEnabled).toBe(false)

    await owner.profile.update({ sharedEnabled: true })

    const created = await owner.transactions.create({
      requestId: crypto.randomUUID(),
      entry: {
        kind: 'EXPENSE',
        amount: 4_200,
        date: todayIso(),
        categoryId: 'groceries',
        title: 'Market',
      },
    })

    const listed = await owner.transactions.list({})
    expect(listed.entries).toHaveLength(1)
    expect(listed.entries[0]?.id).toBe(created.id)
    expect(listed.totals).toEqual({ spent: 4_200, income: 0, count: 1 })

    const exported = await owner.transactions.exportCsv({})
    expect(exported.filename).toMatch(/^spliit-personal-/)
    expect(exported.csv).toContain('Market')

    const overview = await owner.overview.get({})
    expect(overview.spent).toBe(4_200)
    expect(overview.categories[0]).toMatchObject({
      categoryId: 'groceries',
      amount: 4_200,
    })

    const budget = await owner.budgets.create({
      name: 'Food',
      amount: 5_000,
      categoryScope: 'SELECTED',
      categoryIds: ['food-and-drink'],
    })
    const withBudget = await owner.overview.get({})
    expect(withBudget.budgets.find((b) => b.id === budget.id)).toMatchObject({
      spent: 4_200,
      remaining: 800,
      state: 'TRENDING',
    })

    await owner.budgets.create({
      name: 'Everything',
      amount: 10_000,
      categoryScope: 'ALL',
      categoryIds: [],
    })
    const withOverall = await owner.overview.get({})
    expect(withOverall.overallBudget).toMatchObject({
      name: 'Everything',
      spent: 4_200,
      remaining: 5_800,
    })

    await owner.transactions.update({
      id: created.id,
      entry: { amount: 6_000 },
    })
    const updated = await owner.overview.get({})
    expect(updated.spent).toBe(6_000)
    expect(updated.budgets.find((b) => b.id === budget.id)?.state).toBe('OVER')

    await owner.transactions.delete({ id: created.id })
    const empty = await owner.overview.get({})
    expect(empty.spent).toBe(0)

    // The API rejects a selected budget with no categories.
    await expect(
      owner.budgets.create({
        name: 'Empty',
        amount: 1_000,
        categoryScope: 'SELECTED',
        categoryIds: [],
      }),
    ).rejects.toThrow()

    // The web contract sends `{ id, budget }`; keep it covered here.
    await owner.budgets.update({
      id: budget.id,
      budget: {
        name: 'Food & drink',
        amount: 6_000,
        categoryScope: 'SELECTED',
        categoryIds: ['food-and-drink'],
        startDay: 1,
      },
    })
    const edited = await owner.budgets.list({})
    expect(edited.budgets.find((b) => b.id === budget.id)).toMatchObject({
      name: 'Food & drink',
      amount: 6_000,
    })

    // Out-of-range months fail input validation instead of throwing a 500.
    await expect(owner.overview.get({ month: '2026-13' })).rejects.toThrow()
  })

  it('paginates same-date rows without gaps or duplicates', async () => {
    const pager = caller(pagerId)
    await pager.profile.get()
    const titles = ['Pager A', 'Pager B', 'Pager C']
    for (const title of titles) {
      await pager.transactions.create({
        requestId: crypto.randomUUID(),
        entry: {
          kind: 'EXPENSE',
          amount: 100,
          date: todayIso(),
          categoryId: 'general',
          title,
        },
      })
    }

    const seen: string[] = []
    let cursor: string | undefined
    for (let page = 0; page < 5; page += 1) {
      const result = await pager.transactions.list({
        limit: 1,
        ...(cursor ? { cursor } : {}),
      })
      seen.push(...result.entries.map((entry) => entry.id))
      if (!result.nextCursor) break
      cursor = result.nextCursor
    }
    expect(seen).toHaveLength(3)
    expect(new Set(seen).size).toBe(3)

    // Same amount/date rows exercise the amount-sort tiebreak too.
    const amountSeen: string[] = []
    cursor = undefined
    for (let page = 0; page < 5; page += 1) {
      const result = await pager.transactions.list({
        sort: 'amount',
        direction: 'asc',
        limit: 1,
        ...(cursor ? { cursor } : {}),
      })
      amountSeen.push(...result.entries.map((entry) => entry.id))
      if (!result.nextCursor) break
      cursor = result.nextCursor
    }
    expect(amountSeen).toHaveLength(3)
    expect(new Set(amountSeen).size).toBe(3)
  })

  it('links the holder share and honors per-expense overrides', async () => {
    const owner = caller(ownerId)
    const partner = caller(partnerId)

    await owner.profile.get()
    await owner.profile.update({ sharedEnabled: true })
    await owner.sources.updateRule({
      groupId,
      included: true,
      includeFrom: null,
    })

    // The partner has not opened Personal yet, so no profile exists and the
    // sync must not create one as a side effect.
    await runPersonalSyncResult(
      PersonalInclusionService.use((service) => service.syncExpense(expenseId)),
    )

    const ownerRow = await prisma.personalTransaction.findUnique({
      where: {
        accountId_sourceExpenseId: {
          accountId: ownerId,
          sourceExpenseId: expenseId,
        },
      },
    })
    expect(ownerRow).toMatchObject({
      source: 'GROUP',
      amount: 5_000,
      categoryId: 'dining-out',
      sourceGroupId: groupId,
    })
    expect(
      await prisma.personalTransaction.count({
        where: { accountId: partnerId, sourceExpenseId: expenseId },
      }),
    ).toBe(0)

    await partner.profile.get()
    await partner.profile.update({ sharedEnabled: true })
    await partner.sources.updateRule({
      groupId,
      included: true,
      includeFrom: null,
    })
    await runPersonalSync(
      PersonalInclusionService.use((service) => service.syncExpense(expenseId)),
    )

    const partnerRow = await prisma.personalTransaction.findUnique({
      where: {
        accountId_sourceExpenseId: {
          accountId: partnerId,
          sourceExpenseId: expenseId,
        },
      },
    })
    expect(partnerRow?.amount).toBe(5_000)

    // Editing the group expense updates linked rows without touching them
    // through the personal API.
    await prisma.expense.update({
      where: { id: expenseId },
      data: { amount: 12_000 },
    })
    await runPersonalSync(
      PersonalInclusionService.use((service) => service.syncExpense(expenseId)),
    )
    const updatedPartner = await prisma.personalTransaction.findUnique({
      where: {
        accountId_sourceExpenseId: {
          accountId: partnerId,
          sourceExpenseId: expenseId,
        },
      },
    })
    expect(updatedPartner?.amount).toBe(6_000)

    // The master gate is authoritative even when a caller filters by GROUP.
    await owner.profile.update({ sharedEnabled: false })
    const hidden = await owner.transactions.list({ source: 'GROUP' })
    expect(hidden.entries).toHaveLength(0)
    await owner.profile.update({ sharedEnabled: true })
    const visible = await owner.transactions.list({ source: 'GROUP' })
    expect(visible.entries.some((entry) => entry.id === ownerRow!.id)).toBe(
      true,
    )

    await owner.sources.setExpenseOverride({
      expenseId,
      state: 'EXCLUDE',
      categoryId: null,
    })
    expect(
      await prisma.personalTransaction.count({
        where: { accountId: ownerId, sourceExpenseId: expenseId },
      }),
    ).toBe(0)
    expect(
      await prisma.personalTransaction.count({
        where: { accountId: partnerId, sourceExpenseId: expenseId },
      }),
    ).toBe(1)

    // Leaving a group freezes the holder's history. Later edits must not
    // rewrite a frozen snapshot, and deleting the source must not erase it.
    await runPersonalSync(
      PersonalInclusionService.use((service) =>
        service.freeze(partnerId, groupId),
      ),
    )
    await prisma.expense.update({
      where: { id: expenseId },
      data: { amount: 14_000 },
    })
    await runPersonalSync(
      PersonalInclusionService.use((service) => service.syncExpense(expenseId)),
    )
    const frozen = await prisma.personalTransaction.findUnique({
      where: {
        accountId_sourceExpenseId: {
          accountId: partnerId,
          sourceExpenseId: expenseId,
        },
      },
    })
    expect(frozen?.amount).toBe(6_000)
    expect(frozen?.sourceDetachedAt).not.toBeNull()

    await prisma.expense.delete({ where: { id: expenseId } })
    await runPersonalSync(
      PersonalInclusionService.use((service) =>
        service.deleteExpense(expenseId),
      ),
    )
    expect(
      await prisma.personalTransaction.count({
        where: { sourceExpenseId: expenseId },
      }),
    ).toBe(1)
  })
})
