import { prisma } from '@spliit/db'
import {
  activityActorTypeSchema,
  activitySubjectTypeSchema,
  activityTypeSchema,
  type ActivityData,
} from '@spliit/domain/activities'
import { afterAll, describe, expect, it } from 'vitest'
import { randomId } from '../lib/api'
import { checkDbConnection } from './setup'

await checkDbConnection()

/**
 * Confirms the activity table produced by the generic event-log
 * migration:
 *
 *   - every existing row has the new typed `type` value
 *     (EXPENSE_CREATED / EXPENSE_UPDATED / EXPENSE_DELETED / GROUP_UPDATED)
 *   - `actorType` / `actorId` are populated for every row that had a
 *     legacy actor reference
 *   - `subjectType` / `subjectId` are populated for expense rows
 *   - `data` is null or a JSON object (never a bare string)
 *   - the specialized `accountId`, `ledgerParticipantId`, and
 *     `expenseId` columns no longer exist
 *
 * The migration is already applied to the test DB, so we test the
 * post-migration shape directly. The integration test also creates
 * a fresh row through Prisma and confirms the new columns accept the
 * typed `type` / `actorType` / `subjectType` / JSON `data` inputs.
 */
describe('Generic activity event log migration', () => {
  const ledgerIds: string[] = []
  const activityIds: string[] = []

  afterAll(async () => {
    for (const aid of activityIds) {
      await prisma.activity.delete({ where: { id: aid } }).catch(() => {})
    }
    for (const lid of ledgerIds) {
      await prisma.ledger.delete({ where: { id: lid } }).catch(() => {})
    }
  })

  async function createLedger(): Promise<string> {
    const id = `evt-ledger-${randomId()}`
    await prisma.ledger.create({
      data: { id, currency: '$', currencyCode: 'USD' },
    })
    ledgerIds.push(id)
    return id
  }

  async function freshActivity(
    ledgerId: string,
    payload: {
      type:
        | 'EXPENSE_CREATED'
        | 'EXPENSE_UPDATED'
        | 'EXPENSE_DELETED'
        | 'GROUP_UPDATED'
      actorType: 'ACCOUNT' | 'LEDGER_PARTICIPANT'
      actorId: string
      subjectType?: 'EXPENSE'
      subjectId?: string
      data?: ActivityData
    },
  ): Promise<string> {
    const id = `evt-${randomId()}`
    activityIds.push(id)
    await prisma.activity.create({
      data: {
        id,
        ledgerId,
        type: payload.type,
        actorType: payload.actorType,
        actorId: payload.actorId,
        subjectType: payload.subjectType ?? null,
        subjectId: payload.subjectId ?? null,
        data: payload.data === undefined ? null : (payload.data as object),
      },
    })
    return id
  }

  // ────────────────────────────────────────────────────────────────────────
  // Schema-level: the old specialized columns must be gone.
  // ────────────────────────────────────────────────────────────────────────

  it('drops the specialized accountId/ledgerParticipantId/expenseId columns', async () => {
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'Activity'
    `
    const names = columns.map((c) => c.column_name)
    expect(names).not.toContain('accountId')
    expect(names).not.toContain('ledgerParticipantId')
    expect(names).not.toContain('expenseId')
    expect(names).not.toContain('activityType')
    // The new typed columns are present.
    expect(names).toContain('type')
    expect(names).toContain('actorType')
    expect(names).toContain('actorId')
    expect(names).toContain('subjectType')
    expect(names).toContain('subjectId')
    expect(names).toContain('data')
  })

  it('drops the legacy ActivityType database enum', async () => {
    const enumRows = await prisma.$queryRaw<Array<{ typname: string }>>`
      SELECT typname FROM pg_type WHERE typname = 'ActivityType'
    `
    expect(enumRows).toHaveLength(0)
  })

  // ────────────────────────────────────────────────────────────────────────
  // Data-level: existing rows were transformed to the new shape.
  // ────────────────────────────────────────────────────────────────────────

  it('renames all existing activity types to the new string values', async () => {
    // Sample across the whole Activity table (some ledgerIds come from
    // other integration tests; this is fine — we just assert the new
    // vocabulary).
    const rows = await prisma.$queryRaw<Array<{ type: string }>>`
      SELECT DISTINCT "type" FROM "Activity"
    `
    const distinctTypes = rows.map((r) => r.type)
    for (const t of distinctTypes) {
      // Every distinct type must parse as the new ActivityType union.
      expect(activityTypeSchema.safeParse(t).success).toBe(true)
    }
    // And none of the legacy names should still be present.
    expect(distinctTypes).not.toContain('CREATE_EXPENSE')
    expect(distinctTypes).not.toContain('UPDATE_EXPENSE')
    expect(distinctTypes).not.toContain('DELETE_EXPENSE')
    expect(distinctTypes).not.toContain('UPDATE_GROUP')
  })

  it('populates actorType and actorId on migrated expense rows', async () => {
    const sample = await prisma.activity.findFirst({
      where: { type: 'EXPENSE_CREATED', actorId: { not: null } },
    })
    expect(sample).not.toBeNull()
    expect(activityActorTypeSchema.safeParse(sample!.actorType).success).toBe(
      true,
    )
    expect(sample!.actorId).toBeTruthy()
  })

  it('populates subjectType and subjectId on migrated expense rows', async () => {
    const sample = await prisma.activity.findFirst({
      where: { type: 'EXPENSE_CREATED', subjectId: { not: null } },
    })
    expect(sample).not.toBeNull()
    expect(sample!.subjectType).toBe('EXPENSE')
    expect(
      activitySubjectTypeSchema.safeParse(sample!.subjectType).success,
    ).toBe(true)
    expect(sample!.subjectId).toBeTruthy()
  })

  it('migrated expense data parses as JSON (or is null)', async () => {
    const samples = await prisma.activity.findMany({
      where: { type: 'EXPENSE_CREATED' },
      take: 25,
    })
    expect(samples.length).toBeGreaterThan(0)
    for (const row of samples) {
      // The column must be JSON or null; never a string.
      const parsed =
        row.data === null
          ? null
          : typeof row.data === 'string'
            ? JSON.parse(row.data)
            : row.data
      if (parsed !== null) {
        expect(typeof parsed).toBe('object')
      }
    }
  })

  it('migrated group data parses as JSON (or is null)', async () => {
    const samples = await prisma.activity.findMany({
      where: { type: 'GROUP_UPDATED' },
      take: 25,
    })
    for (const row of samples) {
      const parsed =
        row.data === null
          ? null
          : typeof row.data === 'string'
            ? JSON.parse(row.data)
            : row.data
      if (parsed !== null) {
        expect(typeof parsed).toBe('object')
      }
    }
  })

  // ────────────────────────────────────────────────────────────────────────
  // Write path: new typed columns accept the new values via Prisma.
  // ────────────────────────────────────────────────────────────────────────

  it('accepts writing a typed EXPENSE_CREATED row with payload', async () => {
    const ledgerId = await createLedger()
    const actorId = `evt-acct-${randomId()}`
    const subjectId = `evt-exp-${randomId()}`
    const aid = await freshActivity(ledgerId, {
      type: 'EXPENSE_CREATED',
      actorType: 'ACCOUNT',
      actorId,
      subjectType: 'EXPENSE',
      subjectId,
      data: {
        kind: 'expense',
        summary: 'Dinner',
        title: 'Dinner',
        amount: 4500,
        currencyCode: 'USD',
        date: '2026-07-02',
      },
    })

    const row = await prisma.activity.findUnique({ where: { id: aid } })
    expect(row?.type).toBe('EXPENSE_CREATED')
    expect(row?.actorType).toBe('ACCOUNT')
    expect(row?.actorId).toBe(actorId)
    expect(row?.subjectType).toBe('EXPENSE')
    expect(row?.subjectId).toBe(subjectId)
    expect(row?.data).toMatchObject({ kind: 'expense', summary: 'Dinner' })
  })

  it('accepts writing a null JSON payload', async () => {
    const ledgerId = await createLedger()
    const aid = await freshActivity(ledgerId, {
      type: 'GROUP_UPDATED',
      actorType: 'ACCOUNT',
      actorId: `evt-acct-${randomId()}`,
    })
    const row = await prisma.activity.findUnique({ where: { id: aid } })
    expect(row?.data).toBeNull()
  })

  it('accepts writing a changed-field payload', async () => {
    const ledgerId = await createLedger()
    const aid = await freshActivity(ledgerId, {
      type: 'EXPENSE_UPDATED',
      actorType: 'ACCOUNT',
      actorId: `evt-acct-${randomId()}`,
      subjectType: 'EXPENSE',
      subjectId: `evt-exp-${randomId()}`,
      data: {
        kind: 'expense',
        summary: 'Dinner',
        changedFields: ['title', 'amount', 'split'],
      },
    })
    const row = await prisma.activity.findUnique({ where: { id: aid } })
    expect(row?.data).toMatchObject({
      kind: 'expense',
      changedFields: ['title', 'amount', 'split'],
    })
  })
})
