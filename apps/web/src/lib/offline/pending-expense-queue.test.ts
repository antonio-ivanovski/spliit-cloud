import 'fake-indexeddb/auto'
import { Dexie } from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildNamespace, OFFLINE_DB_NAME } from './contract'
import {
  deleteOfflineDatabaseForTests,
  OFFLINE_DB_STORES_V1,
  openOfflineDatabase,
} from './database'
import {
  buildPendingExpenseRecord,
  createPendingExpenseCreateFn,
  deletePendingExpenseRecord,
  EXPENSE_CREATE_PROCEDURE_PATH,
  getMutationProcedurePath,
  isExpenseCreateMutation,
  isExpenseCreateOpPath,
  listPendingExpenseRecords,
  markPendingExpenseFailed,
  queuedClientIdFor,
  queuedExpenseResult,
  resolvePendingExpenseRecord,
  resolvePendingNamespace,
  savePendingExpenseRecord,
} from './pending-expense-queue'
import { OfflineRepository } from './repository'

// Authoring gate (test-audit): this file owns queue adaptation — mutation
// identification (mutationKey/meta/op.path), record building/validation,
// namespace resolution, and the Dexie outbox round-trip including the v1→v2
// upgrade. Flush policy is owned by pending-expense-flush.test.ts; overlay
// behavior by pending-expenses.test.tsx.

const NAMESPACE_A = buildNamespace('http://localhost:3001', 'queue-a')
const NAMESPACE_B = buildNamespace('http://localhost:3001', 'queue-b')

const REQUEST_ID = '00000000-0000-4000-8000-000000000001'

function makeExpense(overrides?: Record<string, unknown>) {
  return {
    title: 'Dinner',
    amount: 3000,
    paidByList: [{ participant: 'payer-1', shares: 3000 }],
    paidBySplitMode: 'BY_AMOUNT',
    isMultiPayer: false,
    paidFor: [{ participant: 'payer-1', shares: 1 }],
    category: 'general',
    splitMode: 'EVENLY',
    expenseDate: new Date('2026-03-02T12:00:00.000Z'),
    expenseTimeZone: 'UTC',
    documents: [],
    recurrenceRule: 'NONE',
    ...overrides,
  }
}

function makeRecord(overrides?: Record<string, unknown>) {
  return buildPendingExpenseRecord({
    namespace: NAMESPACE_A,
    groupId: 'g1',
    requestId: REQUEST_ID,
    expense: makeExpense(),
    createdAtMs: 1_000,
    ...overrides,
  })
}

describe('expense-create mutation identification', () => {
  it('recognizes the tRPC v11 mutationKey shape', () => {
    expect(
      isExpenseCreateMutation({
        mutationKey: [['groups', 'expenses', 'create']],
      }),
    ).toBe(true)
    expect(
      getMutationProcedurePath({
        mutationKey: [['groups', 'expenses', 'create'], { groupId: 'g1' }],
      }),
    ).toBe(EXPENSE_CREATE_PROCEDURE_PATH)
  })

  it('rejects other procedures, malformed keys, and missing identity', () => {
    expect(
      isExpenseCreateMutation({
        mutationKey: [['groups', 'expenses', 'update']],
      }),
    ).toBe(false)
    expect(isExpenseCreateMutation({ mutationKey: [['groups']] })).toBe(false)
    expect(isExpenseCreateMutation({ mutationKey: [] })).toBe(false)
    // Bare strings never occur as TanStack mutation keys (always arrays);
    // only the array shape diverts.
    expect(
      isExpenseCreateMutation({ mutationKey: 'groups.expenses.create' }),
    ).toBe(false)
    expect(isExpenseCreateMutation({})).toBe(false)
    expect(isExpenseCreateMutation({ mutationKey: [[42]] })).toBe(false)
    expect(getMutationProcedurePath({})).toBeNull()
  })

  it('supports the meta procedurePath escape hatch for imperative calls', () => {
    expect(
      isExpenseCreateMutation({
        meta: { procedurePath: ['groups', 'expenses', 'create'] },
      }),
    ).toBe(true)
    expect(
      isExpenseCreateMutation({
        meta: { procedurePath: 'groups.expenses.create' },
      }),
    ).toBe(true)
    expect(
      isExpenseCreateMutation({
        meta: { procedurePath: ['groups', 'expenses', 'update'] },
      }),
    ).toBe(false)
  })

  it('matches link operation paths exactly', () => {
    expect(isExpenseCreateOpPath('groups.expenses.create')).toBe(true)
    expect(isExpenseCreateOpPath('groups.expenses.update')).toBe(false)
    expect(isExpenseCreateOpPath('')).toBe(false)
    expect(isExpenseCreateOpPath(undefined)).toBe(false)
    expect(isExpenseCreateOpPath(['groups', 'expenses', 'create'])).toBe(false)
  })
})

describe('pending expense records', () => {
  it('builds a valid record with the temp id derived from the request id', () => {
    const record = makeRecord()

    expect(record).not.toBeNull()
    expect(record?.clientId).toBe(`pending-${REQUEST_ID}`)
    expect(queuedClientIdFor(REQUEST_ID)).toBe(`pending-${REQUEST_ID}`)
    expect(record?.status).toBe('pending')
    expect(record?.expense.expenseDate).toBeInstanceOf(Date)
  })

  it('rejects invalid variables without throwing', () => {
    expect(makeRecord({ groupId: '' })).toBeNull()
    expect(makeRecord({ requestId: 'not-a-uuid' })).toBeNull()
    expect(makeRecord({ expense: makeExpense({ amount: 0 }) })).toBeNull()
    expect(makeRecord({ expense: { nonsense: true } })).toBeNull()
  })

  it('builds synthetic queued results carrying the temp id', () => {
    const record = makeRecord()
    if (!record) throw new Error('expected a valid record')
    expect(queuedExpenseResult(record)).toEqual({
      expenseId: `pending-${REQUEST_ID}`,
      recurringSeriesId: null,
    })
  })

  it('resolves namespaces from the cached account, null otherwise', () => {
    expect(resolvePendingNamespace('queue-a')).toBe(NAMESPACE_A)
    expect(resolvePendingNamespace(null)).toBeNull()
    expect(resolvePendingNamespace(undefined)).toBeNull()
    expect(resolvePendingNamespace('')).toBeNull()
  })
})

describe('pending expense Dexie outbox', () => {
  beforeEach(async () => {
    await deleteOfflineDatabaseForTests()
  })

  afterEach(async () => {
    await deleteOfflineDatabaseForTests()
  })

  it('round-trips records scoped by namespace', async () => {
    const record = makeRecord()
    expect(record).not.toBeNull()
    await savePendingExpenseRecord(record)
    await savePendingExpenseRecord(
      makeRecord({
        namespace: NAMESPACE_B,
        requestId: '00000000-0000-4000-8000-000000000002',
        createdAtMs: 2_000,
      }),
    )

    const rows = await listPendingExpenseRecords(NAMESPACE_A)
    expect(rows).toHaveLength(1)
    expect((rows[0] as { clientId: string }).clientId).toBe(
      `pending-${REQUEST_ID}`,
    )
    expect(await listPendingExpenseRecords(NAMESPACE_B)).toHaveLength(1)
    expect(
      await listPendingExpenseRecords(
        buildNamespace('http://localhost:3001', 'nobody'),
      ),
    ).toEqual([])
  })

  it('rejects invalid records without writing', async () => {
    await expect(savePendingExpenseRecord({ bogus: true })).rejects.toThrow()
    expect(await listPendingExpenseRecords(NAMESPACE_A)).toEqual([])
  })

  it('resolves sent by deleting and failed by pinning status', async () => {
    const sent = makeRecord()
    const failed = makeRecord({
      requestId: '00000000-0000-4000-8000-000000000002',
      createdAtMs: 2_000,
    })
    await savePendingExpenseRecord(sent)
    await savePendingExpenseRecord(failed)

    await resolvePendingExpenseRecord(NAMESPACE_A, {
      groupId: 'g1',
      clientId: `pending-${REQUEST_ID}`,
      outcome: 'sent',
    })
    await resolvePendingExpenseRecord(NAMESPACE_A, {
      groupId: 'g1',
      clientId: 'pending-00000000-0000-4000-8000-000000000002',
      outcome: 'failed',
    })

    const rows = (await listPendingExpenseRecords(NAMESPACE_A)) as Array<{
      clientId: string
      status: string
    }>
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'failed' })
    // Resolving an unknown key is a no-op, never a failure.
    await resolvePendingExpenseRecord(NAMESPACE_A, {
      groupId: 'g1',
      clientId: 'pending-missing',
      outcome: 'sent',
    })
    await deletePendingExpenseRecord({
      namespace: NAMESPACE_A,
      groupId: 'g1',
      clientId: 'pending-missing',
    })
    await markPendingExpenseFailed({
      namespace: NAMESPACE_A,
      groupId: 'g1',
      clientId: 'pending-missing',
    })
  })

  it('upgrades v1 databases to v2 keeping existing rows', async () => {
    // Freeze a realistic v1 database: full v1 stores plus a group-meta row
    // stamped schemaVersion 1 (the shape real clients persisted), then close.
    const v1 = new Dexie(OFFLINE_DB_NAME)
    v1.version(1).stores(OFFLINE_DB_STORES_V1)
    await v1.open()
    await v1.table('groupMeta').put({
      namespace: NAMESPACE_A,
      groupId: 'g1',
      schemaVersion: 1,
      serverRevision: 'o2.c0.v0',
      capturedAt: new Date('2026-01-01T00:00:00.000Z'),
      storedAt: new Date('2026-01-01T00:00:00.000Z'),
      commitNonce: 'nonce-v1',
      dirtySince: null,
      lastConfirmedAt: new Date('2026-01-01T00:00:00.000Z'),
      totalCount: 0,
      hasMore: false,
      truncatedAt: null,
    })
    v1.close()

    const db = await openOfflineDatabase()
    try {
      expect(db.verno).toBe(2)
      await expect(db.table('groupMeta').count()).resolves.toBe(1)
      // The new outbox starts empty and accepts writes.
      await expect(db.table('pendingExpenses').count()).resolves.toBe(0)
    } finally {
      db.close()
    }

    // The v1 snapshot must stay readable (not `unsupported`) so the next
    // pass refreshes it in place instead of bricking the offline cache.
    const repository = await OfflineRepository.open()
    try {
      const meta = await repository.readGroupMeta(NAMESPACE_A, 'g1')
      expect(meta.status).toBe('ready')
    } finally {
      repository.close()
    }
  })

  it('builds a vanilla mutate client without the guard link', () => {
    const createExpense = createPendingExpenseCreateFn({
      baseUrl: 'http://localhost:3001',
      fetchFn: () => Promise.reject(new Error('no network in unit tests')),
    })
    expect(typeof createExpense).toBe('function')
  })
})
