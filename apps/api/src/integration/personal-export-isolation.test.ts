import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prisma } from '@spliit/db'

import { loadAccountExportSource } from '../lib/exports/account-snapshot'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

const runId = testRunId()
const accountA = `acct-personal-export-a-${runId}`
const accountB = `acct-personal-export-b-${runId}`

beforeAll(async () => {
  for (const [id, name] of [
    [accountA, 'Export A'],
    [accountB, 'Export B'],
  ]) {
    await prisma.user.create({
      data: { id, email: `${id}@test.example`, name, emailVerified: true },
    })
    await prisma.personalProfile.create({
      data: { accountId: id, currencyCode: 'USD', timeZone: 'UTC' },
    })
  }

  await prisma.personalTransaction.createMany({
    data: [
      {
        id: `ptx-a-${runId}`,
        accountId: accountA,
        kind: 'EXPENSE',
        amount: 1000,
        currencyCode: 'USD',
        date: new Date('2026-08-10T00:00:00.000Z'),
        categoryId: 'groceries',
        title: 'A groceries',
        source: 'PERSONAL',
      },
      {
        id: `ptx-b-${runId}`,
        accountId: accountB,
        kind: 'EXPENSE',
        amount: 2000,
        currencyCode: 'USD',
        date: new Date('2026-08-10T00:00:00.000Z'),
        categoryId: 'groceries',
        title: 'B groceries',
        source: 'PERSONAL',
      },
    ],
  })
  await prisma.personalBudget.createMany({
    data: [
      {
        id: `bud-a-${runId}`,
        accountId: accountA,
        name: 'A budget',
        amount: 5000,
        currencyCode: 'USD',
        timeZone: 'UTC',
        categoryScope: 'ALL',
        categoryIds: [],
        startDay: 1,
      },
      {
        id: `bud-b-${runId}`,
        accountId: accountB,
        name: 'B budget',
        amount: 6000,
        currencyCode: 'USD',
        timeZone: 'UTC',
        categoryScope: 'ALL',
        categoryIds: [],
        startDay: 1,
      },
    ],
  })
})

afterAll(async () => {
  await prisma.personalTransaction.deleteMany({
    where: { accountId: { in: [accountA, accountB] } },
  })
  await prisma.personalBudget.deleteMany({
    where: { accountId: { in: [accountA, accountB] } },
  })
  await prisma.personalProfile.deleteMany({
    where: { accountId: { in: [accountA, accountB] } },
  })
  await prisma.user.deleteMany({
    where: { id: { in: [accountA, accountB] } },
  })
})

const personalOnlySelection = {
  sections: {
    GROUPS: false,
    FRIENDS: false,
    STARRED: false,
    ARCHIVED: false,
    HIDDEN: false,
  },
  groupOverrides: [],
  includeDocuments: false,
  includeAccountPreferences: false,
  includeGroupPreferences: false,
  includePersonal: true,
}

describe('personal export account isolation — real DB', () => {
  it('never leaks another account personal rows', async () => {
    const sourceA = await prisma.$transaction(
      (tx) =>
        loadAccountExportSource(accountA, personalOnlySelection as never, tx),
      { isolationLevel: 'RepeatableRead' },
    )
    const sourceB = await prisma.$transaction(
      (tx) =>
        loadAccountExportSource(accountB, personalOnlySelection as never, tx),
      { isolationLevel: 'RepeatableRead' },
    )

    expect(sourceA.personal?.transactions.map((t) => t.id)).toEqual([
      `ptx-a-${runId}`,
    ])
    expect(sourceB.personal?.transactions.map((t) => t.id)).toEqual([
      `ptx-b-${runId}`,
    ])
    expect(sourceA.personal?.budgets.map((b) => b.id)).toEqual([
      `bud-a-${runId}`,
    ])
    expect(sourceB.personal?.budgets.map((b) => b.id)).toEqual([
      `bud-b-${runId}`,
    ])
  })

  it('accepts a personal-only export with no groups', async () => {
    const source = await prisma.$transaction(
      (tx) =>
        loadAccountExportSource(accountA, personalOnlySelection as never, tx),
      { isolationLevel: 'RepeatableRead' },
    )
    expect(source.groups).toEqual([])
    expect(source.personal).not.toBeNull()
  })
})
