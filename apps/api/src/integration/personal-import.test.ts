import { createHash } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prisma } from '@spliit/db'

import { personalRouter } from '../trpc/routers/personal'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

const runId = testRunId()
const ownerId = `acct-personal-import-${runId}`

function sha(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function caller(accountId: string) {
  return personalRouter.createCaller({
    auth: {
      session: { id: 'sess-personal-import' },
      user: {
        id: accountId,
        email: `${accountId}@test.example`,
        emailVerified: true,
        name: accountId,
      },
    },
  } as never)
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

beforeAll(async () => {
  await prisma.user.create({
    data: {
      id: ownerId,
      email: `${ownerId}@test.example`,
      name: 'Import Owner',
      emailVerified: true,
    },
  })
})

afterAll(async () => {
  await prisma.personalFileImportSource.deleteMany({
    where: { accountId: ownerId },
  })
  await prisma.personalTransaction.deleteMany({
    where: { accountId: ownerId },
  })
  await prisma.personalProfile.deleteMany({ where: { accountId: ownerId } })
  await prisma.user.deleteMany({ where: { id: ownerId } })
})

describe('personal file import — real DB', () => {
  it('commits a mixed batch, dedupes, and replays idempotently', async () => {
    const owner = caller(ownerId)
    const profile = await owner.profile.get()
    expect(profile.currencyCode).toBeTruthy()
    const currency = profile.currencyCode
    const date = todayIso()

    // Seed a linked GROUP row that a bank row will match (shared label).
    const groupRowId = `pt-group-${runId}`
    await prisma.personalTransaction.create({
      data: {
        id: groupRowId,
        accountId: ownerId,
        kind: 'EXPENSE',
        amount: 1250,
        currencyCode: currency,
        date: new Date(`${date}T00:00:00.000Z`),
        categoryId: 'groceries',
        title: 'Market shared',
        source: 'GROUP',
        sourceExpenseId: `exp-shared-${runId}`,
        sourceGroupId: `grp-shared-${runId}`,
        sourceGroupName: 'Shared group',
      },
    })

    const expenseRow = {
      rowId: 'row-expense-1',
      rowNumber: 2,
      source: {
        baseFingerprint: sha(`base-expense-1-${runId}`),
        originFingerprint: sha(`origin-expense-1-${runId}`),
      },
      entry: {
        kind: 'EXPENSE' as const,
        amount: 4200,
        currencyCode: currency,
        date,
        categoryId: 'groceries',
        title: 'Market',
      },
    }
    const incomeRow = {
      rowId: 'row-income-1',
      rowNumber: 3,
      source: {
        baseFingerprint: sha(`base-income-1-${runId}`),
        originFingerprint: sha(`origin-income-1-${runId}`),
      },
      entry: {
        kind: 'INCOME' as const,
        amount: 9000,
        currencyCode: currency,
        date,
        categoryId: 'income',
        title: 'Paycheck',
      },
    }
    const sharedRow = {
      rowId: 'row-shared-1',
      rowNumber: 4,
      source: {
        baseFingerprint: sha(`base-shared-1-${runId}`),
        originFingerprint: sha(`origin-shared-1-${runId}`),
      },
      entry: {
        kind: 'EXPENSE' as const,
        amount: 1250,
        currencyCode: currency,
        date,
        categoryId: 'groceries',
        title: 'Market shared',
      },
    }

    const preview = await owner.import.preview({
      rows: [expenseRow, incomeRow, sharedRow],
    })
    const sharedPreview = preview.rows.find(
      (row) => row.rowId === sharedRow.rowId,
    )
    expect(sharedPreview?.matches.length).toBeGreaterThan(0)
    expect(
      sharedPreview?.matches.some(
        (match) =>
          match.kind === 'EXISTING_TRANSACTION' && match.source === 'GROUP',
      ),
    ).toBe(true)

    const requestId = crypto.randomUUID()
    const committed = await owner.import.commit({
      requestId,
      rows: [expenseRow, incomeRow],
    })
    expect(committed.importedCount).toBe(2)
    expect(committed.transactionIds).toHaveLength(2)

    const listed = await owner.transactions.list({ limit: 100 })
    expect(
      listed.entries.filter((entry) => entry.source === 'PERSONAL').length,
    ).toBeGreaterThanOrEqual(2)
    expect(listed.totals.spent).toBeGreaterThanOrEqual(4200)
    expect(listed.totals.income).toBeGreaterThanOrEqual(9000)

    const provenance = await prisma.personalFileImportSource.findMany({
      where: { accountId: ownerId },
    })
    expect(provenance.length).toBe(2)
    expect(provenance.every((row) => row.provider === 'GENERIC_CSV')).toBe(true)

    // Idempotent replay with the same requestId and input returns the same ids.
    const replayed = await owner.import.commit({
      requestId,
      rows: [expenseRow, incomeRow],
    })
    expect(replayed).toEqual(committed)

    // The committed rows are now exact re-imports.
    const rePreview = await owner.import.preview({
      rows: [expenseRow, incomeRow],
    })
    expect(
      rePreview.rows.every((row) =>
        row.matches.some((match) => match.kind === 'EXACT_IMPORT'),
      ),
    ).toBe(true)

    // Approved duplicates import as new rows.
    const approvedCommit = await owner.import.commit({
      requestId: crypto.randomUUID(),
      rows: [
        {
          ...sharedRow,
          approvedDuplicateKeys:
            sharedPreview?.matches.map((match) => match.key) ?? [],
        },
      ],
    })
    expect(approvedCommit.importedCount).toBe(1)
  })
})
