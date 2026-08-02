import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createDatabaseRuntime, type PrismaClient } from '@spliit/db'
import { calculateExactShares, type ExactAmount } from '@spliit/domain'

import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = resolve(here, '../../../../packages/db/prisma/migrations')
const TARGET_MIGRATION = '20260802111340_share_fixed_point'

const adminUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:1234@localhost/postgres'

async function createTempDatabase(): Promise<{ name: string; url: string }> {
  const admin = createDatabaseRuntime({ DATABASE_URL: adminUrl })
  const name =
    `spliit_share_migration_${testRunId().replace(/[^a-z0-9_]/gi, '')}`.toLowerCase()
  await admin.basePrisma.$executeRawUnsafe(`CREATE DATABASE "${name}"`)
  await admin.basePrisma.$disconnect()
  const url = new URL(adminUrl)
  url.pathname = `/${name}`
  return { name, url: url.toString() }
}

async function dropTempDatabase(name: string) {
  const admin = createDatabaseRuntime({ DATABASE_URL: adminUrl })
  try {
    await admin.basePrisma.$executeRawUnsafe(
      `DROP DATABASE IF EXISTS "${name}"`,
    )
  } finally {
    await admin.basePrisma.$disconnect()
  }
}

async function replayMigration(client: PrismaClient, sql: string) {
  await client.$executeRawUnsafe(sql)
}

/** Seed the pre-migration schema with every relational owner mode. */
async function seedLegacyData(client: PrismaClient) {
  await client.$executeRawUnsafe(`
    INSERT INTO "Ledger" ("id", "currency", "currencyCode", "createdAt")
    VALUES ('lg-1', '$', 'USD', CURRENT_TIMESTAMP);

    INSERT INTO "Account" ("id", "email", "emailVerified", "name", "createdAt", "updatedAt")
    VALUES
      ('acct-1', 'migration-test@example.local', true, 'Migration Tester', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('acct-2', 'migration-test-2@example.local', true, 'Migration Tester 2', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

    INSERT INTO "Group" ("id", "name", "ledgerId", "createdAt")
    VALUES ('grp-1', 'Migration Group', 'lg-1', CURRENT_TIMESTAMP);

    INSERT INTO "LedgerParticipant" ("id", "ledgerId", "kind")
    VALUES
      ('lp-a', 'lg-1', 'ACCOUNT_MEMBER'),
      ('lp-b', 'lg-1', 'ACCOUNT_MEMBER'),
      ('lp-c', 'lg-1', 'ACCOUNT_MEMBER');

    INSERT INTO "Expense" ("id", "ledgerId", "expenseDate", "title", "categoryId", "amount", "paidBySplitMode", "isReimbursement", "splitMode", "createdAt")
    VALUES
      ('e-shares', 'lg-1', CURRENT_DATE, 'Shares expense', 'general', 3000, 'BY_SHARES', false, 'BY_SHARES', CURRENT_TIMESTAMP),
      ('e-even', 'lg-1', CURRENT_DATE, 'Even expense', 'general', 2000, 'BY_AMOUNT', false, 'EVENLY', CURRENT_TIMESTAMP),
      ('e-pct', 'lg-1', CURRENT_DATE, 'Pct expense', 'general', 1000, 'BY_AMOUNT', false, 'BY_PERCENTAGE', CURRENT_TIMESTAMP),
      ('e-amt', 'lg-1', CURRENT_DATE, 'Amount expense', 'general', 1000, 'BY_AMOUNT', false, 'BY_AMOUNT', CURRENT_TIMESTAMP);

    INSERT INTO "ExpensePaidFor" ("expenseId", "ledgerParticipantId", "shares")
    VALUES
      ('e-shares', 'lp-a', 2),
      ('e-shares', 'lp-b', 1),
      ('e-even', 'lp-a', 1),
      ('e-even', 'lp-b', 1),
      ('e-pct', 'lp-a', 7000),
      ('e-pct', 'lp-b', 3000),
      ('e-amt', 'lp-a', 600),
      ('e-amt', 'lp-b', 400);

    INSERT INTO "ExpensePaidBy" ("expenseId", "ledgerParticipantId", "shares")
    VALUES
      ('e-shares', 'lp-a', 1),
      ('e-shares', 'lp-b', 1),
      ('e-even', 'lp-a', 2000),
      ('e-pct', 'lp-a', 1000),
      ('e-amt', 'lp-a', 1000);

    INSERT INTO "Expense" ("id", "ledgerId", "expenseDate", "title", "categoryId", "amount", "paidBySplitMode", "isReimbursement", "splitMode", "createdAt")
    VALUES ('e-item', 'lg-1', CURRENT_DATE, 'Itemized', 'general', 3000, 'BY_AMOUNT', false, 'ITEMIZED', CURRENT_TIMESTAMP);

    INSERT INTO "ExpenseItem" ("id", "expenseId", "title", "unitPrice", "quantity", "amount", "splitMode", "createdAt")
    VALUES
      ('it-1', 'e-item', 'Beer', 1000, 1, 1000, 'BY_SHARES', CURRENT_TIMESTAMP),
      ('it-2', 'e-item', 'Wine', 2000, 1, 2000, 'BY_PERCENTAGE', CURRENT_TIMESTAMP);

    INSERT INTO "ExpenseItemPaidFor" ("expenseItemId", "ledgerParticipantId", "shares")
    VALUES
      ('it-1', 'lp-a', 2), ('it-1', 'lp-b', 1),
      ('it-2', 'lp-a', 7000), ('it-2', 'lp-b', 3000);

    INSERT INTO "ExpenseItemizedRemainder" ("expenseId", "splitMode")
    VALUES ('e-item', 'BY_SHARES');

    INSERT INTO "ExpenseItemizedRemainderPaidFor" ("expenseId", "ledgerParticipantId", "shares")
    VALUES ('e-item', 'lp-a', 3), ('e-item', 'lp-b', 3);

    INSERT INTO "Expense" ("id", "ledgerId", "expenseDate", "title", "categoryId", "amount", "paidBySplitMode", "isReimbursement", "splitMode", "createdAt")
    VALUES ('e-item2', 'lg-1', CURRENT_DATE, 'Evenly remainder', 'general', 2000, 'BY_AMOUNT', false, 'ITEMIZED', CURRENT_TIMESTAMP);

    INSERT INTO "ExpenseItemizedRemainder" ("expenseId", "splitMode")
    VALUES ('e-item2', 'EVENLY');

    INSERT INTO "ExpenseItemizedRemainderPaidFor" ("expenseId", "ledgerParticipantId", "shares")
    VALUES ('e-item2', 'lp-a', 1), ('e-item2', 'lp-b', 1), ('e-item2', 'lp-c', 1);

    INSERT INTO "AccountGroupDefaultSplit" ("id", "accountId", "groupId", "splitMode", "createdAt", "updatedAt")
    VALUES
      ('ds-1', 'acct-1', 'grp-1', 'BY_SHARES', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('ds-2', 'acct-2', 'grp-1', 'BY_PERCENTAGE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

    INSERT INTO "AccountGroupDefaultSplitPaidFor" ("defaultSplitId", "participantId", "shares")
    VALUES
      ('ds-1', 'lp-a', 5), ('ds-1', 'lp-b', 2),
      ('ds-2', 'lp-a', 7000), ('ds-2', 'lp-b', 3000);

    INSERT INTO "RecurringExpenseSeries" (
      "id", "ledgerId", "frequency", "interval", "anchorDate", "anchorSequence",
      "nextOccurrenceDate", "nextOccurrenceOrdinal", "endType", "occurrencesCreated",
      "status", "template", "version", "createdAt", "updatedAt"
    )
    VALUES (
      'rs-shares', 'lg-1', 'WEEKLY', 1, CURRENT_DATE, 1, CURRENT_DATE + INTERVAL '7 days', 2, 'INDEFINITE', 1, 'ACTIVE',
      '{"title":"Shares series","categoryId":"general","amount":3000,"originalAmount":null,"originalCurrency":null,"conversionRate":null,"conversionSource":null,"paidBySplitMode":"BY_SHARES","paidByList":[{"ledgerParticipantId":"lp-a","shares":1},{"ledgerParticipantId":"lp-b","shares":1}],"paidFor":[{"ledgerParticipantId":"lp-a","shares":2},{"ledgerParticipantId":"lp-b","shares":1}],"splitMode":"BY_SHARES","isReimbursement":false,"notes":null,"items":[{"title":"Beer","unitPrice":1000,"quantity":1,"amount":1000,"splitMode":"BY_SHARES","paidFor":[{"ledgerParticipantId":"lp-a","shares":2},{"ledgerParticipantId":"lp-b","shares":1}]}],"itemizedRemainder":{"splitMode":"BY_SHARES","paidFor":[{"ledgerParticipantId":"lp-a","shares":3},{"ledgerParticipantId":"lp-b","shares":3}]}}'::JSONB,
      1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    ),
    (
      'rs-even', 'lg-1', 'WEEKLY', 1, CURRENT_DATE, 1, CURRENT_DATE + INTERVAL '7 days', 2, 'INDEFINITE', 1, 'ACTIVE',
      '{"title":"Even series","categoryId":"general","amount":2000,"originalAmount":null,"originalCurrency":null,"conversionRate":null,"conversionSource":null,"paidBySplitMode":"BY_AMOUNT","paidByList":[{"ledgerParticipantId":"lp-a","shares":2000}],"paidFor":[{"ledgerParticipantId":"lp-a","shares":1},{"ledgerParticipantId":"lp-b","shares":1}],"splitMode":"EVENLY","isReimbursement":false,"notes":null,"items":[],"itemizedRemainder":null}'::JSONB,
      1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    ),
    (
      -- Mixed modes per path: flat paid-for is EVENLY (untouched), paid-by
      -- is BY_SHARES (×100), one item is BY_SHARES (×100) while the other
      -- is BY_PERCENTAGE (untouched), and the remainder is BY_SHARES (×100).
      'rs-mixed', 'lg-1', 'WEEKLY', 1, CURRENT_DATE, 1, CURRENT_DATE + INTERVAL '7 days', 2, 'INDEFINITE', 1, 'ACTIVE',
      '{"title":"Mixed series","categoryId":"general","amount":3000,"originalAmount":null,"originalCurrency":null,"conversionRate":null,"conversionSource":null,"paidBySplitMode":"BY_SHARES","paidByList":[{"ledgerParticipantId":"lp-a","shares":1},{"ledgerParticipantId":"lp-b","shares":1}],"paidFor":[{"ledgerParticipantId":"lp-a","shares":1},{"ledgerParticipantId":"lp-b","shares":1}],"splitMode":"EVENLY","isReimbursement":false,"notes":null,"items":[{"title":"Beer","unitPrice":1000,"quantity":1,"amount":1000,"splitMode":"BY_SHARES","paidFor":[{"ledgerParticipantId":"lp-a","shares":2},{"ledgerParticipantId":"lp-b","shares":1}]},{"title":"Wine","unitPrice":2000,"quantity":1,"amount":2000,"splitMode":"BY_PERCENTAGE","paidFor":[{"ledgerParticipantId":"lp-a","shares":7000},{"ledgerParticipantId":"lp-b","shares":3000}]}],"itemizedRemainder":{"splitMode":"BY_SHARES","paidFor":[{"ledgerParticipantId":"lp-a","shares":3},{"ledgerParticipantId":"lp-b","shares":3}]}}'::JSONB,
      1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );
  `)
}

describe('share fixed-point migration', () => {
  it(
    'scales only BY_SHARES relational rows and template JSON by ×100',
    { timeout: 120_000 },
    async () => {
      const temp = await createTempDatabase()
      const runtime = createDatabaseRuntime({ DATABASE_URL: temp.url })
      const client = runtime.basePrisma
      try {
        // Replay every migration before the target so the schema matches
        // the pre-change production shape.
        const migrationNames = readdirSync(migrationsDir).sort()
        const targetIndex = migrationNames.indexOf(TARGET_MIGRATION)
        expect(targetIndex).toBeGreaterThan(0)
        for (const name of migrationNames.slice(0, targetIndex)) {
          const sql = readFileSync(
            resolve(migrationsDir, name, 'migration.sql'),
            'utf8',
          )
          await replayMigration(client, sql)
        }

        await seedLegacyData(client)

        const before = (await client.$queryRawUnsafe(`
          SELECT 'ExpensePaidFor' AS tbl, "expenseId" AS id, "ledgerParticipantId" AS pid, "shares"
          FROM "ExpensePaidFor"
          UNION ALL
          SELECT 'ExpensePaidBy', "expenseId", "ledgerParticipantId", "shares"
          FROM "ExpensePaidBy"
          UNION ALL
          SELECT 'ExpenseItemPaidFor', "expenseItemId", "ledgerParticipantId", "shares"
          FROM "ExpenseItemPaidFor"
          UNION ALL
          SELECT 'ExpenseItemizedRemainderPaidFor', "expenseId", "ledgerParticipantId", "shares"
          FROM "ExpenseItemizedRemainderPaidFor"
          UNION ALL
          SELECT 'AccountGroupDefaultSplitPaidFor', "defaultSplitId", "participantId", "shares"
          FROM "AccountGroupDefaultSplitPaidFor"
          ORDER BY 1, 2, 3;
        `)) as Array<{ tbl: string; id: string; pid: string; shares: number }>
        const beforeMap = new Map(
          before.map((r) => [`${r.tbl}|${r.id}|${r.pid}`, r.shares]),
        )

        // Capture the exact per-participant allocation for every
        // BY_SHARES paid-for expense so the post-migration rows can be
        // proven allocation-equivalent (ratios must be unchanged by ×100).
        const beforeAllocations = (await client.$queryRawUnsafe(`
          SELECT e."id" AS expense_id, e."amount", e."splitMode",
                 pf."ledgerParticipantId" AS pid, pf."shares"
          FROM "Expense" e
          JOIN "ExpensePaidFor" pf ON pf."expenseId" = e."id"
          WHERE e."splitMode" = 'BY_SHARES'
          ORDER BY e."id", pf."ledgerParticipantId";
        `)) as Array<{
          expense_id: string
          amount: number
          splitMode: string
          pid: string
          shares: number
        }>
        const exactBefore = Object.fromEntries(
          beforeAllocations.map((row) => [
            row.expense_id,
            calculateExactShares({
              amount: row.amount,
              splitMode: row.splitMode as never,
              participants: beforeAllocations
                .filter((r) => r.expense_id === row.expense_id)
                .map((r) => ({ id: r.pid, shares: r.shares })),
            }),
          ]),
        ) as Record<string, Record<string, ExactAmount>>

        const targetSql = readFileSync(
          resolve(migrationsDir, TARGET_MIGRATION, 'migration.sql'),
          'utf8',
        )
        await replayMigration(client, targetSql)

        // ── Relational assertions ──────────────────────────────────
        const rows = (await client.$queryRawUnsafe(`
          SELECT
            pf."expenseId" AS id, pf."ledgerParticipantId" AS pid, pf."shares", e."splitMode"
          FROM "ExpensePaidFor" pf
          JOIN "Expense" e ON e."id" = pf."expenseId"
          ORDER BY pf."expenseId", pf."ledgerParticipantId";
        `)) as Array<{
          id: string
          pid: string
          shares: number
          splitMode: string
        }>
        for (const row of rows) {
          const beforeShares = beforeMap.get(
            `ExpensePaidFor|${row.id}|${row.pid}`,
          ) as number
          if (row.splitMode === 'BY_SHARES') {
            expect(row.shares).toBe(beforeShares * 100)
          } else {
            expect(row.shares).toBe(beforeShares)
          }
        }

        const paidBy = (await client.$queryRawUnsafe(`
          SELECT pb."expenseId" AS id, pb."ledgerParticipantId" AS pid, pb."shares", e."paidBySplitMode"
          FROM "ExpensePaidBy" pb
          JOIN "Expense" e ON e."id" = pb."expenseId"
          ORDER BY pb."expenseId", pb."ledgerParticipantId";
        `)) as Array<{
          id: string
          pid: string
          shares: number
          paidBySplitMode: string
        }>
        for (const row of paidBy) {
          const beforeShares = beforeMap.get(
            `ExpensePaidBy|${row.id}|${row.pid}`,
          ) as number
          if (row.paidBySplitMode === 'BY_SHARES') {
            expect(row.shares).toBe(beforeShares * 100)
          } else {
            expect(row.shares).toBe(beforeShares)
          }
        }

        const itemRows = (await client.$queryRawUnsafe(`
          SELECT ipf."expenseItemId" AS id, ipf."ledgerParticipantId" AS pid, ipf."shares", i."splitMode"
          FROM "ExpenseItemPaidFor" ipf
          JOIN "ExpenseItem" i ON i."id" = ipf."expenseItemId"
          ORDER BY ipf."expenseItemId", ipf."ledgerParticipantId";
        `)) as Array<{
          id: string
          pid: string
          shares: number
          splitMode: string
        }>
        for (const row of itemRows) {
          const beforeShares = beforeMap.get(
            `ExpenseItemPaidFor|${row.id}|${row.pid}`,
          ) as number
          if (row.splitMode === 'BY_SHARES') {
            expect(row.shares).toBe(beforeShares * 100)
          } else {
            expect(row.shares).toBe(beforeShares)
          }
        }

        const remainderRows = (await client.$queryRawUnsafe(`
          SELECT rpf."expenseId" AS id, rpf."ledgerParticipantId" AS pid, rpf."shares", r."splitMode"
          FROM "ExpenseItemizedRemainderPaidFor" rpf
          JOIN "ExpenseItemizedRemainder" r ON r."expenseId" = rpf."expenseId"
          ORDER BY rpf."expenseId", rpf."ledgerParticipantId";
        `)) as Array<{
          id: string
          pid: string
          shares: number
          splitMode: string
        }>
        for (const row of remainderRows) {
          const beforeShares = beforeMap.get(
            `ExpenseItemizedRemainderPaidFor|${row.id}|${row.pid}`,
          ) as number
          if (row.splitMode === 'BY_SHARES') {
            expect(row.shares).toBe(beforeShares * 100)
          } else {
            expect(row.shares).toBe(beforeShares)
          }
        }

        const defaultRows = (await client.$queryRawUnsafe(`
          SELECT dpf."defaultSplitId" AS id, dpf."participantId" AS pid, dpf."shares", ds."splitMode"
          FROM "AccountGroupDefaultSplitPaidFor" dpf
          JOIN "AccountGroupDefaultSplit" ds ON ds."id" = dpf."defaultSplitId"
          ORDER BY dpf."defaultSplitId", dpf."participantId";
        `)) as Array<{
          id: string
          pid: string
          shares: number
          splitMode: string
        }>
        for (const row of defaultRows) {
          const beforeShares = beforeMap.get(
            `AccountGroupDefaultSplitPaidFor|${row.id}|${row.pid}`,
          ) as number
          if (row.splitMode === 'BY_SHARES') {
            expect(row.shares).toBe(beforeShares * 100)
          } else {
            expect(row.shares).toBe(beforeShares)
          }
        }

        // ── Allocation equivalence ─────────────────────────────────
        // Recomputing the exact rational allocation from the scaled rows
        // must reproduce the pre-migration allocation for every BY_SHARES
        // paid-for expense (×100 preserves the ratio exactly).
        const afterAllocations = (await client.$queryRawUnsafe(`
          SELECT e."id" AS expense_id, e."amount", e."splitMode",
                 pf."ledgerParticipantId" AS pid, pf."shares"
          FROM "Expense" e
          JOIN "ExpensePaidFor" pf ON pf."expenseId" = e."id"
          WHERE e."splitMode" = 'BY_SHARES'
          ORDER BY e."id", pf."ledgerParticipantId";
        `)) as Array<{
          expense_id: string
          amount: number
          splitMode: string
          pid: string
          shares: number
        }>
        for (const expenseId of Object.keys(exactBefore)) {
          const exactAfter = calculateExactShares({
            amount: afterAllocations.find((r) => r.expense_id === expenseId)!
              .amount,
            splitMode: 'BY_SHARES' as never,
            participants: afterAllocations
              .filter((r) => r.expense_id === expenseId)
              .map((r) => ({ id: r.pid, shares: r.shares })),
          })
          expect(exactAfter).toEqual(exactBefore[expenseId])
        }

        // ── Recurring template JSON ────────────────────────────────
        const templates = (await client.$queryRawUnsafe(
          `SELECT "id", "template" FROM "RecurringExpenseSeries" ORDER BY "id";`,
        )) as Array<{ id: string; template: unknown }>
        const sharesTemplate = templates.find((t) => t.id === 'rs-shares')!
          .template as {
          paidByList: Array<{ shares: number }>
          paidFor: Array<{ shares: number }>
          items: Array<{
            splitMode: string
            paidFor: Array<{ shares: number }>
          }>
          itemizedRemainder: {
            splitMode: string
            paidFor: Array<{ shares: number }>
          }
        }
        expect(sharesTemplate.paidByList.map((r) => r.shares)).toEqual([
          100, 100,
        ])
        expect(sharesTemplate.paidFor.map((r) => r.shares)).toEqual([200, 100])
        expect(sharesTemplate.items[0].paidFor.map((r) => r.shares)).toEqual([
          200, 100,
        ])
        expect(
          sharesTemplate.itemizedRemainder.paidFor.map((r) => r.shares),
        ).toEqual([300, 300])

        const evenTemplate = templates.find((t) => t.id === 'rs-even')!
          .template as { paidFor: Array<{ shares: number }> }
        expect(evenTemplate.paidFor.map((r) => r.shares)).toEqual([1, 1])

        // Mixed template: only the BY_SHARES paths scale; EVENLY flat
        // paid-for and the BY_PERCENTAGE item stay untouched.
        const mixedTemplate = templates.find((t) => t.id === 'rs-mixed')!
          .template as {
          paidByList: Array<{ shares: number }>
          paidFor: Array<{ shares: number }>
          items: Array<{
            splitMode: string
            paidFor: Array<{ shares: number }>
          }>
          itemizedRemainder: {
            splitMode: string
            paidFor: Array<{ shares: number }>
          }
        }
        expect(mixedTemplate.paidByList.map((r) => r.shares)).toEqual([
          100, 100,
        ])
        expect(mixedTemplate.paidFor.map((r) => r.shares)).toEqual([1, 1])
        expect(mixedTemplate.items[0].splitMode).toBe('BY_SHARES')
        expect(mixedTemplate.items[0].paidFor.map((r) => r.shares)).toEqual([
          200, 100,
        ])
        expect(mixedTemplate.items[1].splitMode).toBe('BY_PERCENTAGE')
        expect(mixedTemplate.items[1].paidFor.map((r) => r.shares)).toEqual([
          7000, 3000,
        ])
        expect(mixedTemplate.itemizedRemainder.splitMode).toBe('BY_SHARES')
        expect(
          mixedTemplate.itemizedRemainder.paidFor.map((r) => r.shares),
        ).toEqual([300, 300])

        // ── Monetary values are untouched ──────────────────────────
        const amounts = (await client.$queryRawUnsafe(
          `SELECT "amount", "splitMode" FROM "Expense" ORDER BY "id";`,
        )) as Array<{ amount: number; splitMode: string }>
        // Ordered by id: e-amt=1000, e-even=2000, e-item=3000, e-item2=2000, e-pct=1000, e-shares=3000
        expect(amounts.map((r) => r.amount)).toEqual([
          1000, 2000, 3000, 2000, 1000, 3000,
        ])

        // ── Column defaults moved to 100 ───────────────────────────
        const paidForDefault = (await client.$queryRawUnsafe(`
          SELECT column_default FROM information_schema.columns
          WHERE table_name = 'ExpensePaidFor' AND column_name = 'shares';
        `)) as Array<{ column_default: string }>
        expect(paidForDefault[0].column_default).toBe('100')
        const paidByDefault = (await client.$queryRawUnsafe(`
          SELECT column_default FROM information_schema.columns
          WHERE table_name = 'ExpensePaidBy' AND column_name = 'shares';
        `)) as Array<{ column_default: string }>
        expect(paidByDefault[0].column_default).toBe('100')
      } finally {
        await runtime.basePrisma.$disconnect().catch(() => {})
        await dropTempDatabase(temp.name)
      }
    },
  )

  it(
    'aborts the whole migration when a BY_SHARES value would overflow INT',
    { timeout: 120_000 },
    async () => {
      const temp = await createTempDatabase()
      const runtime = createDatabaseRuntime({ DATABASE_URL: temp.url })
      const client = runtime.basePrisma
      try {
        const migrationNames = readdirSync(migrationsDir).sort()
        const targetIndex = migrationNames.indexOf(TARGET_MIGRATION)
        for (const name of migrationNames.slice(0, targetIndex)) {
          await replayMigration(
            client,
            readFileSync(resolve(migrationsDir, name, 'migration.sql'), 'utf8'),
          )
        }

        await client.$executeRawUnsafe(`
          INSERT INTO "Ledger" ("id", "currency", "currencyCode", "createdAt")
          VALUES ('lg-ovf', '$', 'USD', CURRENT_TIMESTAMP);
          INSERT INTO "LedgerParticipant" ("id", "ledgerId", "kind")
          VALUES ('lp-ovf', 'lg-ovf', 'ACCOUNT_MEMBER');
          INSERT INTO "Expense" ("id", "ledgerId", "expenseDate", "title", "categoryId", "amount", "paidBySplitMode", "isReimbursement", "splitMode", "createdAt")
          VALUES ('e-ovf', 'lg-ovf', CURRENT_DATE, 'Overflow', 'general', 1000, 'BY_AMOUNT', false, 'BY_SHARES', CURRENT_TIMESTAMP);
          -- 21,474,837 × 100 > 2,147,483,647 → preflight must abort.
          INSERT INTO "ExpensePaidFor" ("expenseId", "ledgerParticipantId", "shares")
          VALUES ('e-ovf', 'lp-ovf', 21474837);
        `)

        const targetSql = readFileSync(
          resolve(migrationsDir, TARGET_MIGRATION, 'migration.sql'),
          'utf8',
        )
        await expect(replayMigration(client, targetSql)).rejects.toThrow(
          /overflow/,
        )

        // The transaction rolled back — the pre-existing row was not
        // scaled and the migration table has no record.
        const shares = (await client.$queryRawUnsafe(
          `SELECT "shares" FROM "ExpensePaidFor" WHERE "expenseId" = 'e-ovf';`,
        )) as Array<{ shares: number }>
        expect(shares[0].shares).toBe(21474837)
      } finally {
        await runtime.basePrisma.$disconnect().catch(() => {})
        await dropTempDatabase(temp.name)
      }
    },
  )
})
