import { randomUUID } from 'node:crypto'

import { PrismaPg } from '@prisma/adapter-pg'
import { config } from 'dotenv'
import { expect, it } from 'vitest'

import { conversionFromStored, expenseApiSchema } from '@spliit/domain'

import { PrismaClient } from '../generated/prisma/client/client'
import '../prisma-json'
import { seedDevelopmentData } from './seed'

it('seeds, preserves edits on rerun, resets, and cleans only fixture groups in a rolled-back real DB transaction', async () => {
  config({ path: new URL('../../../../.env', import.meta.url), quiet: true })
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl)
    throw new Error('Integration test requires an existing local DATABASE_URL.')
  const url = new URL(databaseUrl)
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.search
  )
    throw new Error(
      'Fixture integration test requires a loopback PostgreSQL URL without query parameters.',
    )
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: databaseUrl,
      max: 1,
      connectionTimeoutMillis: 5000,
    }),
  })
  const accountId = `seed-test-${randomUUID()}`
  const rollback = new Error('intentional fixture-test rollback')
  try {
    await expect(
      prisma.$transaction(
        async (tx) => {
          const account = await tx.user.create({
            data: {
              id: accountId,
              email: `${accountId}@example.test`,
              name: 'Temporary seed test account',
            },
          })
          const unrelatedId = `${accountId}-unrelated`
          await tx.ledger.create({
            data: {
              id: unrelatedId,
              group: {
                create: {
                  id: unrelatedId,
                  name: 'Unrelated group to preserve',
                  members: {
                    create: {
                      id: `${accountId}-member`,
                      accountId,
                      role: 'ADMIN',
                    },
                  },
                },
              },
            },
          })
          const created = await seedDevelopmentData(tx, account, 'seed')
          expect(created.every((row) => row.status === 'created')).toBe(true)
          // Verify persisted payloads can be loaded back into the expense editor,
          // including source-currency payer cents and computed itemized shares.
          const stored = await tx.expense.findMany({
            where: {
              ledger: {
                group: { id: { in: created.map((row) => row.groupId) } },
              },
            },
            include: {
              paidByList: true,
              paidFor: true,
              items: { include: { paidFor: true } },
              itemizedRemainder: { include: { paidFor: true } },
            },
          })
          for (const expense of stored) {
            const shares = (
              rows: Array<{ ledgerParticipantId: string; shares: number }>,
            ) =>
              rows.map((row) => ({
                participant: row.ledgerParticipantId,
                shares: row.shares,
              }))
            expect(() =>
              expenseApiSchema.parse({
                ...expense,
                notes: expense.notes ?? undefined,
                category: expense.categoryId,
                amount: expense.originalAmount ?? expense.amount,
                conversion: conversionFromStored(expense),
                documents: [],
                recurrenceRule: 'NONE',
                isMultiPayer: expense.paidByList.length > 1,
                paidByList: shares(expense.paidByList),
                paidFor: shares(expense.paidFor),
                items: expense.items.map((item) => ({
                  ...item,
                  notes: item.notes ?? undefined,
                  paidFor: shares(item.paidFor),
                })),
                itemizedRemainder: expense.itemizedRemainder
                  ? {
                      ...expense.itemizedRemainder,
                      paidFor: shares(expense.itemizedRemainder.paidFor),
                    }
                  : undefined,
              }),
            ).not.toThrow()
            if (expense.splitMode === 'ITEMIZED')
              expect(
                expense.paidFor.reduce((sum, row) => sum + row.shares, 0),
              ).toBe(expense.amount)
          }
          const fixtureGroup = created.find((row) =>
            row.name.includes('Shared household'),
          )!
          await tx.group.update({
            where: { id: fixtureGroup.groupId },
            data: { name: 'Manual fixture edit' },
          })
          const firstExpense = await tx.expense.findFirstOrThrow({
            where: { ledger: { group: { id: fixtureGroup.groupId } } },
          })
          await tx.expense.update({
            where: { id: firstExpense.id },
            data: { title: 'Manual expense edit' },
          })
          const rerun = await seedDevelopmentData(tx, account, 'seed')
          expect(rerun.every((row) => row.status === 'skipped')).toBe(true)
          expect(
            (
              await tx.group.findUniqueOrThrow({
                where: { id: fixtureGroup.groupId },
              })
            ).name,
          ).toBe('Manual fixture edit')
          expect(
            (
              await tx.expense.findUniqueOrThrow({
                where: { id: firstExpense.id },
              })
            ).title,
          ).toBe('Manual expense edit')
          const reset = await seedDevelopmentData(tx, account, 'reset')
          expect(reset.every((row) => row.status === 'created')).toBe(true)
          expect(
            (
              await tx.group.findUniqueOrThrow({
                where: { id: fixtureGroup.groupId },
              })
            ).name,
          ).toBe(fixtureGroup.name)
          expect(
            (
              await tx.expense.findUniqueOrThrow({
                where: { id: firstExpense.id },
              })
            ).title,
          ).not.toBe('Manual expense edit')
          await seedDevelopmentData(tx, account, 'clean')
          expect(
            await tx.group.count({
              where: { id: { in: created.map((row) => row.groupId) } },
            }),
          ).toBe(0)
          expect(await tx.ledger.count({ where: { id: unrelatedId } })).toBe(1)
          expect(
            await tx.user.findUnique({ where: { id: accountId } }),
          ).toMatchObject({ name: 'Temporary seed test account' })
          throw rollback
        },
        { timeout: 120000 },
      ),
    ).rejects.toBe(rollback)
    expect(
      await prisma.user.findUnique({ where: { id: accountId } }),
    ).toBeNull()
  } finally {
    await prisma.$disconnect()
  }
})
