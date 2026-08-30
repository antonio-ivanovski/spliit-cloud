import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createDatabaseRuntime, type PrismaClient } from '@spliit/db'

import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = resolve(here, '../../../../packages/db/prisma/migrations')
const TARGET_MIGRATION = '20260824131649_split_presets'
const adminUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:1234@localhost/postgres'

async function createTempDatabase(): Promise<{ name: string; url: string }> {
  const admin = createDatabaseRuntime({ DATABASE_URL: adminUrl })
  const name =
    `spliit_split_preset_migration_${testRunId().replace(/[^a-z0-9_]/gi, '')}`.toLowerCase()
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

async function replayMigrationWithStatementCommits(
  client: PrismaClient,
  sql: string,
) {
  const withoutLineComments = sql.replace(/^\s*--.*$/gm, '')
  for (const statement of withoutLineComments.split(';')) {
    if (statement.trim()) {
      await client.$executeRawUnsafe(statement)
    }
  }
}

describe('split preset migration', () => {
  it(
    'migrates active-member defaults into private presets and removes legacy tables',
    { timeout: 120_000 },
    async () => {
      const temp = await createTempDatabase()
      const runtime = createDatabaseRuntime({ DATABASE_URL: temp.url })
      const client = runtime.basePrisma
      try {
        const migrationNames = readdirSync(migrationsDir).sort()
        const targetIndex = migrationNames.indexOf(TARGET_MIGRATION)
        expect(targetIndex).toBeGreaterThan(0)
        for (const name of migrationNames.slice(0, targetIndex)) {
          await replayMigration(
            client,
            readFileSync(resolve(migrationsDir, name, 'migration.sql'), 'utf8'),
          )
        }

        await client.$executeRawUnsafe(`
          INSERT INTO "Account" ("id", "email", "emailVerified", "name", "createdAt", "updatedAt")
          VALUES
            ('acct-mig-1', 'mig-1@example.local', true, 'Admin One', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('acct-mig-2', 'mig-2@example.local', true, 'Admin Two', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('acct-mig-3', 'mig-3@example.local', true, 'Admin Three', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('acct-mig-member', 'mig-member@example.local', true, 'Member', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('acct-mig-amount', 'mig-amount@example.local', true, 'Amount Member', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('acct-mig-bad-percent', 'mig-bad-percent@example.local', true, 'Bad Percent', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('acct-mig-bad-shares', 'mig-bad-shares@example.local', true, 'Bad Shares', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('acct-mig-stale', 'mig-stale@example.local', true, 'Stale Only', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('acct-mig-left', 'mig-left@example.local', true, 'Former Admin', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
          INSERT INTO "Ledger" ("id", "currency", "currencyCode", "createdAt")
          VALUES ('ledger-mig', '$', 'USD', CURRENT_TIMESTAMP);
          INSERT INTO "Group" ("id", "name", "ledgerId", "createdAt")
          VALUES ('group-mig', 'Migration group', 'ledger-mig', CURRENT_TIMESTAMP);
          INSERT INTO "GroupMember" ("id", "groupId", "accountId", "role", "status", "joinedAt", "createdAt", "updatedAt")
          VALUES
            ('member-mig-1', 'group-mig', 'acct-mig-1', 'ADMIN', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('member-mig-2', 'group-mig', 'acct-mig-2', 'ADMIN', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('member-mig-3', 'group-mig', 'acct-mig-3', 'ADMIN', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('member-mig-member', 'group-mig', 'acct-mig-member', 'MEMBER', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('member-mig-amount', 'group-mig', 'acct-mig-amount', 'MEMBER', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('member-mig-bad-percent', 'group-mig', 'acct-mig-bad-percent', 'MEMBER', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('member-mig-bad-shares', 'group-mig', 'acct-mig-bad-shares', 'MEMBER', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('member-mig-stale', 'group-mig', 'acct-mig-stale', 'MEMBER', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('member-mig-left', 'group-mig', 'acct-mig-left', 'ADMIN', 'LEFT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
          INSERT INTO "LedgerParticipant" ("id", "ledgerId", "groupMemberId", "kind", "displayName", "removedAt")
          VALUES
            ('lp-mig-a', 'ledger-mig', 'member-mig-1', 'ACCOUNT_MEMBER', NULL, NULL),
            ('lp-mig-b', 'ledger-mig', 'member-mig-2', 'ACCOUNT_MEMBER', NULL, NULL),
            ('lp-mig-c', 'ledger-mig', 'member-mig-3', 'ACCOUNT_MEMBER', NULL, NULL),
            ('lp-mig-stale', 'ledger-mig', NULL, 'UNLINKED_PARTICIPANT', 'Removed', CURRENT_TIMESTAMP);
          INSERT INTO "AccountGroupDefaultSplit" ("id", "accountId", "groupId", "splitMode", "createdAt", "updatedAt")
          VALUES
            ('default-mig-1', 'acct-mig-1', 'group-mig', 'BY_SHARES', '2026-01-01T00:00:00Z', CURRENT_TIMESTAMP),
            ('default-mig-2', 'acct-mig-2', 'group-mig', 'BY_SHARES', '2026-01-02T00:00:00Z', CURRENT_TIMESTAMP),
            ('default-mig-3', 'acct-mig-3', 'group-mig', 'EVENLY', '2026-01-03T00:00:00Z', CURRENT_TIMESTAMP),
            ('default-mig-member', 'acct-mig-member', 'group-mig', 'BY_PERCENTAGE', '2026-01-04T00:00:00Z', CURRENT_TIMESTAMP),
            ('default-mig-amount', 'acct-mig-amount', 'group-mig', 'BY_AMOUNT', '2026-01-04T12:00:00Z', CURRENT_TIMESTAMP),
            ('default-mig-bad-percent', 'acct-mig-bad-percent', 'group-mig', 'BY_PERCENTAGE', '2026-01-04T13:00:00Z', CURRENT_TIMESTAMP),
            ('default-mig-bad-shares', 'acct-mig-bad-shares', 'group-mig', 'BY_SHARES', '2026-01-04T14:00:00Z', CURRENT_TIMESTAMP),
            ('default-mig-stale', 'acct-mig-stale', 'group-mig', 'EVENLY', '2026-01-04T15:00:00Z', CURRENT_TIMESTAMP),
            ('default-mig-left', 'acct-mig-left', 'group-mig', 'BY_SHARES', '2026-01-05T00:00:00Z', CURRENT_TIMESTAMP);
          INSERT INTO "AccountGroupDefaultSplitPaidFor" ("defaultSplitId", "participantId", "shares")
          VALUES
            ('default-mig-1', 'lp-mig-a', 200),
            ('default-mig-1', 'lp-mig-b', 100),
            ('default-mig-2', 'lp-mig-a', 200),
            ('default-mig-2', 'lp-mig-b', 100),
            ('default-mig-3', 'lp-mig-a', 50),
            ('default-mig-3', 'lp-mig-c', 50),
            ('default-mig-member', 'lp-mig-a', 3333),
            ('default-mig-member', 'lp-mig-b', 3333),
            ('default-mig-member', 'lp-mig-stale', 3334),
            ('default-mig-amount', 'lp-mig-a', 100),
            ('default-mig-bad-percent', 'lp-mig-a', 4500),
            ('default-mig-bad-percent', 'lp-mig-b', 4500),
            ('default-mig-bad-shares', 'lp-mig-a', 0),
            ('default-mig-stale', 'lp-mig-stale', 1),
            ('default-mig-left', 'lp-mig-a', 1),
            ('default-mig-left', 'lp-mig-c', 1);
        `)

        // Prisma Migrate deploys statements across autocommit boundaries. Run
        // this migration the same way so staging data cannot accidentally rely
        // on the single transaction supplied by the original test harness.
        await replayMigrationWithStatementCommits(
          client,
          readFileSync(
            resolve(migrationsDir, TARGET_MIGRATION, 'migration.sql'),
            'utf8',
          ),
        )

        const presets = (await client.$queryRawUnsafe(`
          SELECT "id", "ownerAccountId", "scopeKey", "name", "nameKey", "target", "splitMode"
          FROM "SplitPreset"
          ORDER BY "ownerAccountId", "createdAt", "id";
        `)) as Array<{
          id: string
          ownerAccountId: string | null
          scopeKey: string
          name: string
          nameKey: string
          target: string
          splitMode: string
        }>
        expect(presets).toEqual([
          {
            id: 'default-mig-1',
            ownerAccountId: 'acct-mig-1',
            scopeKey: 'ACCOUNT:acct-mig-1',
            name: 'Default',
            nameKey: 'default',
            target: 'PAID_FOR',
            splitMode: 'BY_SHARES',
          },
          {
            id: 'default-mig-2',
            ownerAccountId: 'acct-mig-2',
            scopeKey: 'ACCOUNT:acct-mig-2',
            name: 'Default',
            nameKey: 'default',
            target: 'PAID_FOR',
            splitMode: 'BY_SHARES',
          },
          {
            id: 'default-mig-3',
            ownerAccountId: 'acct-mig-3',
            scopeKey: 'ACCOUNT:acct-mig-3',
            name: 'Default',
            nameKey: 'default',
            target: 'PAID_FOR',
            splitMode: 'EVENLY',
          },
          {
            id: 'default-mig-member',
            ownerAccountId: 'acct-mig-member',
            scopeKey: 'ACCOUNT:acct-mig-member',
            name: 'Default',
            nameKey: 'default',
            target: 'PAID_FOR',
            splitMode: 'BY_PERCENTAGE',
          },
        ])

        const rows = (await client.$queryRawUnsafe(`
          SELECT "presetId", "participantId", "shares"
          FROM "SplitPresetParticipant"
          ORDER BY "presetId", "participantId";
        `)) as Array<{
          presetId: string
          participantId: string
          shares: number
        }>
        expect(rows).toEqual([
          { presetId: 'default-mig-1', participantId: 'lp-mig-a', shares: 200 },
          { presetId: 'default-mig-1', participantId: 'lp-mig-b', shares: 100 },
          { presetId: 'default-mig-2', participantId: 'lp-mig-a', shares: 200 },
          { presetId: 'default-mig-2', participantId: 'lp-mig-b', shares: 100 },
          { presetId: 'default-mig-3', participantId: 'lp-mig-a', shares: 1 },
          { presetId: 'default-mig-3', participantId: 'lp-mig-c', shares: 1 },
          {
            presetId: 'default-mig-member',
            participantId: 'lp-mig-a',
            shares: 5000,
          },
          {
            presetId: 'default-mig-member',
            participantId: 'lp-mig-b',
            shares: 5000,
          },
        ])
        expect(
          presets.some((preset) =>
            [
              'default-mig-bad-percent',
              'default-mig-bad-shares',
              'default-mig-stale',
            ].includes(preset.id),
          ),
        ).toBe(false)
        const preferences = (await client.$queryRawUnsafe(`
          SELECT "accountId", "paidForDefaultMode", "paidForDefaultPresetId"
          FROM "AccountGroupPreference"
          WHERE "groupId" = 'group-mig'
          ORDER BY "accountId";
        `)) as Array<{
          accountId: string
          paidForDefaultMode: string
          paidForDefaultPresetId: string | null
        }>
        expect(preferences).toEqual([
          {
            accountId: 'acct-mig-1',
            paidForDefaultMode: 'PRESET',
            paidForDefaultPresetId: 'default-mig-1',
          },
          {
            accountId: 'acct-mig-2',
            paidForDefaultMode: 'PRESET',
            paidForDefaultPresetId: 'default-mig-2',
          },
          {
            accountId: 'acct-mig-3',
            paidForDefaultMode: 'PRESET',
            paidForDefaultPresetId: 'default-mig-3',
          },
          {
            accountId: 'acct-mig-member',
            paidForDefaultMode: 'PRESET',
            paidForDefaultPresetId: 'default-mig-member',
          },
        ])
        const groupDefaults = await client.group.findUniqueOrThrow({
          where: { id: 'group-mig' },
          select: {
            defaultPaidByPresetId: true,
            defaultPaidForPresetId: true,
          },
        })
        expect(groupDefaults).toEqual({
          defaultPaidByPresetId: null,
          defaultPaidForPresetId: null,
        })
        const oldTables = (await client.$queryRawUnsafe(`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN ('AccountGroupDefaultSplit', 'AccountGroupDefaultSplitPaidFor');
        `)) as Array<{ table_name: string }>
        expect(oldTables).toEqual([])
      } finally {
        await runtime.basePrisma.$disconnect().catch(() => {})
        await dropTempDatabase(temp.name)
      }
    },
  )
})
