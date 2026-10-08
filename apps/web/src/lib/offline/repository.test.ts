// NOTE: these Vitest cases run on `fake-indexeddb` mocks.
// Mocks do not prove Safari, PWA, or multi-tab IndexedDB behavior. The
// production browser matrix (installed iOS Safari, Android Chrome, desktop
// Chromium, airplane-mode relaunch, two tabs, upgrade-blocked, quota) must
// still be executed manually before release.
import 'fake-indexeddb/auto'
import { Dexie } from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OFFLINE_DB_NAME, OFFLINE_DB_VERSION, buildNamespace } from './contract'
import { OFFLINE_DB_STORES } from './database'
import { isQuotaError, toStatusErrorCode } from './errors'
import { OfflineRepository } from './repository'

const API_ORIGIN = 'http://localhost:3001'
const ACCOUNT_A = 'account-a'
const ACCOUNT_B = 'account-b'

function namespaceFor(accountId: string, origin = API_ORIGIN): string {
  return buildNamespace(origin, accountId)
}

function overviewEntry(groupId: string) {
  return {
    overview: {
      id: groupId,
      name: `Group ${groupId}`,
      information: null,
      archived: false,
      createdAt: new Date().toISOString(),
      groupType: 'GROUP' as const,
      emoji: null,
      color: null,
      ledger: { currency: 'USD', currencyCode: 'USD' },
      memberCount: 2,
      currentMemberRole: 'MEMBER' as const,
      preference: { starred: false, hidden: false },
      displayName: `Group ${groupId}`,
      friendAccount: null,
      memberAccounts: [],
      financialSummary: {
        expenseCount: 0,
        netBalance: 0,
        state: 'NO_EXPENSES' as const,
        latestExpenseCreatedAt: null,
      },
      access: 'MEMBER' as const,
      viewKey: null,
      lastOpenedAt: null,
    },
    global: {
      id: groupId,
      name: `Group ${groupId}`,
      archived: false,
      hidden: false,
      groupType: 'GROUP' as const,
      displayName: `Group ${groupId}`,
      currency: 'USD',
      currencyCode: 'USD',
      participantCount: 2,
    },
    revision: 'o2.c0.v0',
  }
}

function makeCatalog(
  accountId: string,
  groupIds: string[],
  capturedAt = new Date(),
) {
  return {
    schemaVersion: 2 as const,
    accountId,
    capturedAt,
    groups: groupIds.map((groupId) => overviewEntry(groupId)),
  }
}

function makeExpenseRecord(expenseId: string, expenseDate: Date) {
  const createdAt = new Date(expenseDate)
  const category = {
    id: 'general' as const,
    grouping: 'Uncategorized',
    name: 'General',
  }
  return {
    list: {
      id: expenseId,
      title: `Expense ${expenseId}`,
      amount: 500,
      expenseDate,
      expenseTimeZone: 'UTC',
      categoryId: 'general' as const,
      category,
      splitMode: 'EVENLY' as const,
      paidBySplitMode: 'EVENLY' as const,
      originalAmount: null,
      originalCurrency: null,
      conversionRate: null,
      conversionSource: null,
      originType: null,
      recurrenceSequence: null,
      items: [],
      permissions: {
        canEdit: true,
        canDelete: true,
        canManageRecurrence: false,
      },
      createdAt,
      paidByList: [],
      paidFor: [],
      recurringSeriesId: null,
      recurringSeriesStatus: null,
      documentCount: 0,
    },
    detail: {
      id: expenseId,
      title: `Expense ${expenseId}`,
      amount: 500,
      expenseDate,
      expenseTimeZone: 'UTC',
      categoryId: 'general' as const,
      category,
      splitMode: 'EVENLY' as const,
      paidBySplitMode: 'EVENLY' as const,
      originalAmount: null,
      originalCurrency: null,
      conversionRate: null,
      conversionSource: null,
      originType: null,
      recurrenceSequence: null,
      permissions: {
        canEdit: true,
        canDelete: true,
        canManageRecurrence: false,
      },
      version: 1,
      createdAt,
      notes: null,
      documents: [],
      comments: [],
      paidByList: [],
      paidFor: [],
      items: [],
      itemizedRemainder: null,
      recurringSeriesId: null,
      recurringSeries: null,
      recurrence: null,
      previousExpenseId: null,
      nextExpenseId: null,
    },
  }
}

function makeSnapshot(
  accountId: string,
  groupId: string,
  opts?: {
    capturedAt?: Date
    expenses?: ReturnType<typeof makeExpenseRecord>[]
  },
) {
  const entry = overviewEntry(groupId)
  const capturedAt = opts?.capturedAt ?? new Date()
  const expenses = opts?.expenses ?? []
  const stamp = new Date(capturedAt)
  return {
    schemaVersion: 2 as const,
    accountId,
    groupId,
    capturedAt,
    group: {
      group: {
        id: groupId,
        name: `Group ${groupId}`,
        information: null,
        archived: false,
        createdAt: stamp,
        groupType: 'GROUP' as const,
        emoji: null,
        color: null,
        ledgerId: 'ledger-1',
        friendPairKey: null,
        ledger: {
          id: 'ledger-1',
          currency: 'USD',
          currencyCode: 'USD',
          createdAt: stamp,
        },
        members: [],
        invitations: [],
        currency: 'USD',
        currencyCode: 'USD',
        participants: [],
      },
      displayName: `Group ${groupId}`,
      currentLedgerParticipantId: null,
      currentMember: {
        id: 'member-1',
        role: 'MEMBER' as const,
        status: 'ACTIVE' as const,
      },
      currentInvitation: null,
      linkInviteState: null,
      viewer: {
        source: 'MEMBER' as const,
        access: 'READ_WRITE' as const,
        canMutate: true,
        canAcceptInvitation: false,
      },
      hasSavedView: false,
    },
    overview: entry.overview,
    global: entry.global,
    balances: {
      balances: {},
      suggestedSettlements: [],
      currencyBalances: [],
      participants: [],
      settlement: {
        subgroup: { units: [], legs: [], hasInternalBalances: false },
        individual: { suggestedSettlements: [], policy: 'standard' as const },
      },
    },
    revision: 'o2.c0.v0',
    expenses,
    totalCount: expenses.length,
    downloadedCount: expenses.length,
    hasMore: false,
    truncatedAt: null,
    budgets: [],
    splitPresets: {
      presets: [],
      canManageShared: false,
      canManagePersonal: false,
      groupDefaults: { paidByPresetId: null, paidForPresetId: null },
      personalDefaults: {
        paidBy: { mode: 'INHERIT' as const, presetId: null },
        paidFor: { mode: 'INHERIT' as const, presetId: null },
      },
      effectiveDefaults: { paidByPresetId: null, paidForPresetId: null },
    },
    subgroups: { enabled: false, subgroups: [] },
    activities: [],
    activityTotalCount: 0,
    activityHasMore: false,
  }
}

const opened: OfflineRepository[] = []

async function openRepo(
  options?: Parameters<typeof OfflineRepository.open>[0],
): Promise<OfflineRepository> {
  const repo = await OfflineRepository.open(options)
  opened.push(repo)
  return repo
}

beforeEach(async () => {
  await OfflineRepository.deleteDatabaseForTests()
})

afterEach(async () => {
  for (const repo of opened.splice(0)) {
    try {
      repo.close()
    } catch {
      // Ignore teardown failures.
    }
  }
  vi.restoreAllMocks()
  await OfflineRepository.deleteDatabaseForTests()
})

describe('offline repository', () => {
  it('round-trips Dates via structured cloning', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor(ACCOUNT_A)
    const control = await repo.ensureControl(namespace)
    expect(control).toMatchObject({
      generation: 0,
      dataRevision: 0,
      revoked: false,
    })

    const expenseDate = new Date('2026-09-01T12:00:00.000Z')
    const capturedAt = new Date('2026-09-10T08:30:00.000Z')
    await repo.replaceCatalog({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      catalog: makeCatalog(ACCOUNT_A, ['g1'], capturedAt),
    })
    await repo.commitGroup({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      snapshot: makeSnapshot(ACCOUNT_A, 'g1', {
        capturedAt,
        expenses: [makeExpenseRecord('exp-1', expenseDate)],
      }),
    })

    const catalog = await repo.readCatalog(namespace)
    expect(catalog.status).toBe('ready')
    if (catalog.status !== 'ready') throw new Error('expected catalog')
    expect(catalog.record.capturedAt).toBeInstanceOf(Date)
    expect(catalog.record.capturedAt.getTime()).toBe(capturedAt.getTime())

    const group = await repo.readGroup(namespace, 'g1')
    expect(group.status).toBe('ready')
    if (group.status !== 'ready') throw new Error('expected group')
    expect(group.record.capturedAt).toBeInstanceOf(Date)
    expect(group.record.storedAt).toBeInstanceOf(Date)
    expect(group.record.payload.capturedAt).toBeInstanceOf(Date)
    expect(group.record.payload.expenses[0]?.list.expenseDate).toBeInstanceOf(
      Date,
    )
    expect(group.record.payload.expenses[0]?.list.expenseDate.getTime()).toBe(
      expenseDate.getTime(),
    )
    expect(group.record.commitNonce).toMatch(/.+/)
    expect(group.record.dirtySince).toBeNull()
  })

  it('preserves the old snapshot when a commit is rejected (rollback)', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor(ACCOUNT_A)
    await repo.ensureControl(namespace)
    await repo.replaceCatalog({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      catalog: makeCatalog(ACCOUNT_A, ['g1']),
    })
    const first = makeSnapshot(ACCOUNT_A, 'g1', {
      expenses: [makeExpenseRecord('exp-1', new Date('2026-09-01T12:00Z'))],
    })
    const committed = await repo.commitGroup({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      snapshot: first,
    })

    // Stale dataRevision (e.g. a concurrent delete fence) rejects entirely.
    await expect(
      repo.commitGroup({
        namespace,
        generation: 0,
        expectedDataRevision: 999,
        snapshot: makeSnapshot(ACCOUNT_A, 'g1'),
      }),
    ).rejects.toMatchObject({ code: 'revision-changed' })

    const group = await repo.readGroup(namespace, 'g1')
    expect(group.status).toBe('ready')
    if (group.status !== 'ready') throw new Error('expected group')
    expect(group.record.commitNonce).toBe(committed.commitNonce)
    expect(group.record.payload.expenses).toHaveLength(1)
  })

  it('rejects mutations with a stale generation', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor(ACCOUNT_A)
    await repo.ensureControl(namespace)
    await repo.replaceCatalog({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      catalog: makeCatalog(ACCOUNT_A, ['g1']),
    })
    // Revocation fences in-flight passes by bumping generation.
    const revoked = await repo.revokeNamespace({
      namespace,
      generation: 0,
    })
    expect(revoked.generation).toBe(1)

    await expect(
      repo.commitGroup({
        namespace,
        generation: 0,
        expectedDataRevision: 0,
        snapshot: makeSnapshot(ACCOUNT_A, 'g1'),
      }),
    ).rejects.toMatchObject({ code: 'generation-mismatch' })
  })

  it('does not resurrect revoked data from a late response', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor(ACCOUNT_A)
    await repo.ensureControl(namespace)
    await repo.replaceCatalog({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      catalog: makeCatalog(ACCOUNT_A, ['g1']),
    })
    await repo.commitGroup({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      snapshot: makeSnapshot(ACCOUNT_A, 'g1'),
    })

    const cleared = await repo.revokeNamespace({ namespace, generation: 0 })
    expect(cleared.generation).toBe(1)

    // Late snapshot captured before the clear carries the old generation.
    await expect(
      repo.commitGroup({
        namespace,
        generation: 0,
        expectedDataRevision: 0,
        snapshot: makeSnapshot(ACCOUNT_A, 'g1'),
      }),
    ).rejects.toMatchObject({ code: 'generation-mismatch' })

    expect(await repo.readGroup(namespace, 'g1')).toEqual({
      status: 'missing',
    })
    expect(await repo.readCatalog(namespace)).toEqual({ status: 'missing' })
  })

  it('maps quota failures without auto-evicting other groups', async () => {
    expect(
      isQuotaError(new DOMException('Quota exceeded', 'QuotaExceededError')),
    ).toBe(true)
    expect(toStatusErrorCode(new DOMException('x', 'QuotaExceededError'))).toBe(
      'quota-exceeded',
    )

    const repo = await openRepo()
    const namespace = namespaceFor(ACCOUNT_A)
    await repo.ensureControl(namespace)
    await repo.replaceCatalog({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      catalog: makeCatalog(ACCOUNT_A, ['g1', 'g2']),
    })
    await repo.commitGroup({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      snapshot: makeSnapshot(ACCOUNT_A, 'g1'),
    })
    await repo.commitGroup({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      snapshot: makeSnapshot(ACCOUNT_A, 'g2'),
    })

    // Simulate a quota abort on the next write: the transaction aborts and
    // the previous complete groups stay readable.
    const putSpy = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementationOnce(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      })
    await expect(
      repo.commitGroup({
        namespace,
        generation: 0,
        expectedDataRevision: 0,
        snapshot: makeSnapshot(ACCOUNT_A, 'g1'),
      }),
    ).rejects.toMatchObject({ code: 'quota-exceeded' })
    putSpy.mockRestore()

    expect((await repo.readGroup(namespace, 'g1')).status).toBe('ready')
    expect((await repo.readGroup(namespace, 'g2')).status).toBe('ready')
  })

  it('evicts only the corrupt group and keeps the rest', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor(ACCOUNT_A)
    await repo.ensureControl(namespace)
    await repo.replaceCatalog({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      catalog: makeCatalog(ACCOUNT_A, ['good', 'bad']),
    })
    await repo.commitGroup({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      snapshot: makeSnapshot(ACCOUNT_A, 'good'),
    })
    await repo.commitGroup({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      snapshot: makeSnapshot(ACCOUNT_A, 'bad'),
    })

    // Corrupt the stored group data directly, bypassing commit validation.
    await repo.database.groupData.put({
      namespace,
      groupId: 'bad',
      data: { bogus: true },
    } as never)

    const bad = await repo.readGroup(namespace, 'bad')
    expect(bad.status).toBe('corrupt')
    expect((await repo.readGroup(namespace, 'good')).status).toBe('ready')

    const control = await repo.readControl(namespace)
    await repo.evictGroup({
      namespace,
      generation: control!.generation,
      groupId: 'bad',
    })
    expect(await repo.readGroup(namespace, 'bad')).toEqual({
      status: 'missing',
    })
    expect((await repo.readGroup(namespace, 'good')).status).toBe('ready')
  })

  it('keeps validated groups when the catalog is corrupt', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor(ACCOUNT_A)
    await repo.ensureControl(namespace)
    await repo.replaceCatalog({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      catalog: makeCatalog(ACCOUNT_A, ['g1']),
    })
    await repo.commitGroup({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      snapshot: makeSnapshot(ACCOUNT_A, 'g1'),
    })

    await repo.database.catalogs.put({
      namespace,
      capturedAt: new Date(),
      groups: [{ bogus: true }],
      schemaVersion: 2,
    } as never)

    const catalog = await repo.readCatalog(namespace)
    expect(catalog.status).toBe('corrupt')
    // Validated snapshots stay as explicitly incomplete inventory; totals
    // must be disabled and a catalog refresh requested.
    expect((await repo.readGroup(namespace, 'g1')).status).toBe('ready')
  })

  it('isolates namespaces by account and API origin', async () => {
    const repo = await openRepo()
    const namespaceA = namespaceFor(ACCOUNT_A)
    const namespaceB = namespaceFor(ACCOUNT_B)
    const namespaceOtherOrigin = namespaceFor(
      ACCOUNT_A,
      'https://api.example.com',
    )
    await repo.ensureControl(namespaceA)
    await repo.ensureControl(namespaceB)
    await repo.replaceCatalog({
      namespace: namespaceA,
      generation: 0,
      expectedDataRevision: 0,
      catalog: makeCatalog(ACCOUNT_A, ['g1']),
    })
    await repo.commitGroup({
      namespace: namespaceA,
      generation: 0,
      expectedDataRevision: 0,
      snapshot: makeSnapshot(ACCOUNT_A, 'g1'),
    })

    expect(await repo.readCatalog(namespaceB)).toEqual({ status: 'missing' })
    expect(await repo.readGroup(namespaceB, 'g1')).toEqual({
      status: 'missing',
    })
    expect(await repo.readGroup(namespaceOtherOrigin, 'g1')).toEqual({
      status: 'missing',
    })
    expect(await repo.listGroupStatus(namespaceB)).toEqual([])
  })

  it('refuses newer unsupported schemas without overwriting', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor(ACCOUNT_A)
    await repo.ensureControl(namespace)
    await repo.replaceCatalog({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      catalog: makeCatalog(ACCOUNT_A, ['g1']),
    })
    await repo.commitGroup({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      snapshot: makeSnapshot(ACCOUNT_A, 'g1'),
    })

    const existing = await repo.database.groupMeta.get([namespace, 'g1'])
    await repo.database.groupMeta.put({ ...existing!, schemaVersion: 99 })

    const unsupported = await repo.readGroup(namespace, 'g1')
    expect(unsupported).toEqual({ status: 'unsupported', schemaVersion: 99 })

    await expect(
      repo.commitGroup({
        namespace,
        generation: 0,
        expectedDataRevision: 0,
        snapshot: {
          ...makeSnapshot(ACCOUNT_A, 'g1'),
          schemaVersion: 99,
        } as unknown as Parameters<
          OfflineRepository['commitGroup']
        >[0]['snapshot'],
      }),
    ).rejects.toMatchObject({ code: 'schema-unsupported' })
  })

  it('closes old connections on versionchange', async () => {
    const onVersionChange = vi.fn()
    const repo = await openRepo({ onVersionChange })

    // A newer-client upgrade (same stores, higher declared version)
    // exercises the versionchange/blocking path in Dexie version space.
    // Raw IDB version numbers must not appear here: Dexie maps declared
    // versions to IDB-level numbers internally.
    const newer = new Dexie(OFFLINE_DB_NAME)
    newer.version(OFFLINE_DB_VERSION + 1).stores(OFFLINE_DB_STORES)
    await newer.open()
    newer.close()
    // fake-indexeddb delivers versionchange asynchronously.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(onVersionChange).toHaveBeenCalled()
    // The old connection was closed; avoid reusing it after this test.
    opened.splice(opened.indexOf(repo), 1)
    repo.close()
  })

  it('leaves a newer unsupported database untouched', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor(ACCOUNT_A)
    await repo.ensureControl(namespace)
    await repo.replaceCatalog({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      catalog: makeCatalog(ACCOUNT_A, ['g1']),
    })
    await repo.commitGroup({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      snapshot: makeSnapshot(ACCOUNT_A, 'g1'),
    })
    repo.close()

    // Simulate a newer client upgrading the database with the same stores.
    const newer = new Dexie(OFFLINE_DB_NAME)
    newer.version(OFFLINE_DB_VERSION + 1).stores(OFFLINE_DB_STORES)
    await newer.open()
    newer.close()

    await expect(OfflineRepository.open()).rejects.toMatchObject({
      code: 'schema-unsupported',
    })

    // Untouched: the newer client still reads its data back.
    const probe = new Dexie(OFFLINE_DB_NAME)
    probe.version(OFFLINE_DB_VERSION + 1).stores(OFFLINE_DB_STORES)
    await probe.open()
    await expect(probe.table('groupMeta').count()).resolves.toBe(1)
    probe.close()
  })

  it('stores expense entities with revision metadata and reassembles the snapshot', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor(ACCOUNT_A)
    await repo.ensureControl(namespace)
    await repo.replaceCatalog({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      catalog: makeCatalog(ACCOUNT_A, ['g1']),
    })
    const expenseDate = new Date('2026-09-01T12:00:00.000Z')
    await repo.commitGroup({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      snapshot: makeSnapshot(ACCOUNT_A, 'g1', {
        expenses: [
          makeExpenseRecord('exp-2', expenseDate),
          makeExpenseRecord('exp-1', expenseDate),
        ],
      }),
    })

    const meta = await repo.database.groupMeta.get([namespace, 'g1'])
    expect(meta?.serverRevision).toBe('o2.c0.v0')
    expect(meta?.dirtySince).toBeNull()
    expect(meta?.lastConfirmedAt).toBeInstanceOf(Date)
    expect(await repo.database.expenseList.count()).toBe(2)
    expect(await repo.database.expenseDetail.count()).toBe(2)
    // Indexed scalars serve sort orders without deserializing blobs.
    const byDate = await repo.database.expenseList
      .where('[namespace+groupId+expenseDateMs+createdAtMs+id]')
      .between(
        [namespace, 'g1', 0, 0, ''],
        [
          namespace,
          'g1',
          Number.MAX_SAFE_INTEGER,
          Number.MAX_SAFE_INTEGER,
          '\uffff',
        ],
      )
      .primaryKeys()
    expect(byDate).toHaveLength(2)

    const group = await repo.readGroup(namespace, 'g1')
    expect(group.status).toBe('ready')
    if (group.status !== 'ready') throw new Error('expected group')
    // Server order (expenseDate desc, createdAt desc, id desc) survives the
    // entity round-trip.
    expect(group.record.payload.expenses.map((e) => e.list.id)).toEqual([
      'exp-2',
      'exp-1',
    ])
    expect(group.record.payload.downloadedCount).toBe(2)
    expect(group.record.payload.revision).toBe('o2.c0.v0')
  })

  it('marks groups dirty without rewriting expense history', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor(ACCOUNT_A)
    await repo.ensureControl(namespace)
    await repo.replaceCatalog({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      catalog: makeCatalog(ACCOUNT_A, ['g1']),
    })
    await repo.commitGroup({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      snapshot: makeSnapshot(ACCOUNT_A, 'g1', {
        expenses: [makeExpenseRecord('exp-1', new Date())],
      }),
    })

    const before = await repo.database.expenseList.toArray()
    const { dataRevision } = await repo.markDirty({
      namespace,
      generation: 0,
      dirtyGroupIds: ['g1'],
    })
    expect(dataRevision).toBe(1)
    // History rows are byte-identical; only the metadata flag moved.
    expect(await repo.database.expenseList.toArray()).toEqual(before)
    const meta = await repo.database.groupMeta.get([namespace, 'g1'])
    expect(meta?.dirtySince).toBeInstanceOf(Date)
    const group = await repo.readGroup(namespace, 'g1')
    expect(group.status).toBe('ready')
  })

  it('fences stale snapshots with markDirty dataRevision', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor(ACCOUNT_A)
    await repo.ensureControl(namespace)
    await repo.replaceCatalog({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      catalog: makeCatalog(ACCOUNT_A, ['g1']),
    })
    await repo.commitGroup({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      snapshot: makeSnapshot(ACCOUNT_A, 'g1'),
    })

    const dirty = await repo.markDirty({
      namespace,
      generation: 0,
      dirtyGroupIds: ['g1'],
    })
    expect(dirty.dataRevision).toBe(1)

    const group = await repo.readGroup(namespace, 'g1')
    if (group.status !== 'ready') throw new Error('expected group')
    expect(group.record.dirtySince).toBeInstanceOf(Date)

    await expect(
      repo.commitGroup({
        namespace,
        generation: 0,
        expectedDataRevision: 0,
        snapshot: makeSnapshot(ACCOUNT_A, 'g1'),
      }),
    ).rejects.toMatchObject({ code: 'revision-changed' })
  })

  it('removes absent memberships and fences generation on replaceCatalog', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor(ACCOUNT_A)
    await repo.ensureControl(namespace)
    await repo.replaceCatalog({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      catalog: makeCatalog(ACCOUNT_A, ['keep', 'gone']),
    })
    await repo.commitGroup({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      snapshot: makeSnapshot(ACCOUNT_A, 'keep'),
    })
    await repo.commitGroup({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      snapshot: makeSnapshot(ACCOUNT_A, 'gone'),
    })

    const replaced = await repo.replaceCatalog({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      catalog: makeCatalog(ACCOUNT_A, ['keep']),
    })
    expect(replaced.removedGroupIds).toEqual(['gone'])
    expect(replaced.generation).toBe(1)
    expect(await repo.readGroup(namespace, 'gone')).toEqual({
      status: 'missing',
    })
    expect((await repo.readGroup(namespace, 'keep')).status).toBe('ready')
  })

  it('revokes and fences the namespace', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor(ACCOUNT_A)
    await repo.ensureControl(namespace)
    await repo.replaceCatalog({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      catalog: makeCatalog(ACCOUNT_A, ['g1']),
    })
    await repo.commitGroup({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      snapshot: makeSnapshot(ACCOUNT_A, 'g1'),
    })

    const revoked = await repo.revokeNamespace({ namespace, generation: 0 })
    expect(revoked.generation).toBe(1)
    const control = await repo.readControl(namespace)
    expect(control?.revoked).toBe(true)
    await expect(
      repo.markDirty({ namespace, generation: 1, dirtyGroupIds: [] }),
    ).rejects.toMatchObject({ code: 'namespace-revoked' })
    expect((await repo.readControl(namespace))?.revoked).toBe(true)

    expect(await repo.readGroup(namespace, 'g1')).toEqual({
      status: 'missing',
    })
    await expect(
      repo.commitGroup({
        namespace,
        generation: 1,
        expectedDataRevision: 0,
        snapshot: makeSnapshot(ACCOUNT_A, 'g1'),
      }),
    ).rejects.toMatchObject({ code: 'namespace-revoked' })
  })

  it('fences recordAttempt by generation', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor(ACCOUNT_A)
    await repo.ensureControl(namespace)
    await repo.recordAttempt({
      namespace,
      generation: 0,
      groupId: 'g1',
      result: 'error',
      errorCode: 'storage-unavailable',
    })
    expect(await repo.listGroupStatus(namespace)).toHaveLength(1)

    const cleared = await repo.revokeNamespace({ namespace, generation: 0 })
    expect(cleared.generation).toBe(1)
    expect(await repo.listGroupStatus(namespace)).toEqual([])

    // Late attempt captured before the clear carries the old generation.
    await expect(
      repo.recordAttempt({
        namespace,
        generation: 0,
        groupId: 'g1',
        result: 'error',
      }),
    ).rejects.toMatchObject({ code: 'generation-mismatch' })
    expect(await repo.listGroupStatus(namespace)).toEqual([])
  })

  it('classifies missing schemaVersion as corrupt, not unsupported', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor(ACCOUNT_A)
    await repo.ensureControl(namespace)

    await repo.database.catalogs.put({
      namespace,
      capturedAt: new Date(),
      groups: [],
    } as never)
    await repo.database.groupMeta.put({
      namespace,
      groupId: 'g1',
    } as never)

    const catalog = await repo.readCatalog(namespace)
    expect(catalog.status).toBe('corrupt')
    const group = await repo.readGroup(namespace, 'g1')
    expect(group.status).toBe('corrupt')
  })

  it('maps malformed versions to invalid-payload, not schema-unsupported', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor(ACCOUNT_A)
    await repo.ensureControl(namespace)

    await expect(
      repo.replaceCatalog({
        namespace,
        generation: 0,
        expectedDataRevision: 0,
        catalog: {
          ...makeCatalog(ACCOUNT_A, ['g1']),
          schemaVersion: undefined,
        } as unknown as Parameters<
          OfflineRepository['replaceCatalog']
        >[0]['catalog'],
      }),
    ).rejects.toMatchObject({ code: 'invalid-payload' })

    await expect(
      repo.commitGroup({
        namespace,
        generation: 0,
        expectedDataRevision: 0,
        snapshot: {
          ...makeSnapshot(ACCOUNT_A, 'g1'),
          schemaVersion: '1',
        } as unknown as Parameters<
          OfflineRepository['commitGroup']
        >[0]['snapshot'],
      }),
    ).rejects.toMatchObject({ code: 'invalid-payload' })
  })

  it('enforces lease ownership and expiry', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor(ACCOUNT_A)
    await repo.ensureControl(namespace)
    await repo.replaceCatalog({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      catalog: makeCatalog(ACCOUNT_A, ['g1']),
    })

    async function setLease(owner: string | null, until: number | null) {
      const current = await repo.database.controls.get(namespace)
      await repo.database.controls.put({
        ...current!,
        leaseOwner: owner,
        leaseUntil: until,
      })
    }

    await setLease('owner-a', Date.now() + 30_000)
    await expect(
      repo.commitGroup({
        namespace,
        generation: 0,
        expectedDataRevision: 0,
        snapshot: makeSnapshot(ACCOUNT_A, 'g1'),
        leaseOwner: 'owner-b',
      }),
    ).rejects.toMatchObject({ code: 'lease-conflict' })

    await expect(
      repo.replaceCatalog({
        namespace,
        generation: 0,
        expectedDataRevision: 0,
        catalog: makeCatalog(ACCOUNT_A, []),
        leaseOwner: 'owner-b',
      } as Parameters<OfflineRepository['replaceCatalog']>[0]),
    ).rejects.toMatchObject({ code: 'lease-conflict' })
    const retained = await repo.readCatalog(namespace)
    expect(
      retained.status === 'ready' &&
        retained.record.groups.map((entry) => entry.overview.id),
    ).toEqual(['g1'])

    // Matching owner succeeds while the lease is active.
    await repo.commitGroup({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      snapshot: makeSnapshot(ACCOUNT_A, 'g1'),
      leaseOwner: 'owner-a',
    })

    // Expired leases no longer block a different owner.
    await setLease('owner-a', Date.now() - 1000)
    await repo.commitGroup({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      snapshot: makeSnapshot(ACCOUNT_A, 'g1'),
      leaseOwner: 'owner-b',
    })
  })

  it('reconciles a zero-group catalog and bumps generation', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor(ACCOUNT_A)
    await repo.ensureControl(namespace)
    await repo.replaceCatalog({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      catalog: makeCatalog(ACCOUNT_A, ['keep', 'gone']),
    })
    await repo.commitGroup({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      snapshot: makeSnapshot(ACCOUNT_A, 'keep'),
    })
    await repo.commitGroup({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      snapshot: makeSnapshot(ACCOUNT_A, 'gone'),
    })

    const reconciled = await repo.replaceCatalog({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      catalog: makeCatalog(ACCOUNT_A, []),
    })
    expect(reconciled.removedGroupIds).toEqual(['gone', 'keep'])
    expect(reconciled.generation).toBe(1)
    expect(await repo.readGroup(namespace, 'keep')).toEqual({
      status: 'missing',
    })
    expect(await repo.readGroup(namespace, 'gone')).toEqual({
      status: 'missing',
    })
    const catalog = await repo.readCatalog(namespace)
    expect(catalog.status).toBe('ready')
    if (catalog.status !== 'ready') throw new Error('expected catalog')
    expect(catalog.record.groups).toEqual([])
  })

  it('rejects unsupported commits without overwriting ready data', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor(ACCOUNT_A)
    await repo.ensureControl(namespace)
    await repo.replaceCatalog({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      catalog: makeCatalog(ACCOUNT_A, ['g1']),
    })
    const first = await repo.commitGroup({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      snapshot: makeSnapshot(ACCOUNT_A, 'g1'),
    })

    await expect(
      repo.commitGroup({
        namespace,
        generation: 0,
        expectedDataRevision: 0,
        snapshot: {
          ...makeSnapshot(ACCOUNT_A, 'g1'),
          schemaVersion: 99,
        } as unknown as Parameters<
          OfflineRepository['commitGroup']
        >[0]['snapshot'],
      }),
    ).rejects.toMatchObject({ code: 'schema-unsupported' })

    const group = await repo.readGroup(namespace, 'g1')
    expect(group.status).toBe('ready')
    if (group.status !== 'ready') throw new Error('expected group')
    expect(group.record.commitNonce).toBe(first.commitNonce)
    expect(group.record.schemaVersion).toBe(OFFLINE_DB_VERSION)
  })

  it('uses a unique commitNonce for successive commits', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor(ACCOUNT_A)
    await repo.ensureControl(namespace)
    await repo.replaceCatalog({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      catalog: makeCatalog(ACCOUNT_A, ['g1']),
    })
    const first = await repo.commitGroup({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      snapshot: makeSnapshot(ACCOUNT_A, 'g1'),
    })
    const second = await repo.commitGroup({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      snapshot: makeSnapshot(ACCOUNT_A, 'g1'),
    })
    expect(second.commitNonce).toMatch(/.+/)
    expect(second.commitNonce).not.toBe(first.commitNonce)
  })

  it('rejects namespace/account mismatches as invalid-payload', async () => {
    const repo = await openRepo()
    const namespaceA = namespaceFor(ACCOUNT_A)
    await repo.ensureControl(namespaceA)

    await expect(
      repo.replaceCatalog({
        namespace: namespaceA,
        generation: 0,
        expectedDataRevision: 0,
        catalog: makeCatalog(ACCOUNT_B, ['g1']),
      }),
    ).rejects.toMatchObject({ code: 'invalid-payload' })

    await expect(
      repo.commitGroup({
        namespace: namespaceA,
        generation: 0,
        expectedDataRevision: 0,
        snapshot: makeSnapshot(ACCOUNT_B, 'g1'),
      }),
    ).rejects.toMatchObject({ code: 'invalid-payload' })
  })

  it('confirms unchanged revisions without rewriting history', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor(ACCOUNT_A)
    await repo.ensureControl(namespace)
    await repo.replaceCatalog({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      catalog: makeCatalog(ACCOUNT_A, ['g1']),
    })
    await repo.commitGroup({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      snapshot: makeSnapshot(ACCOUNT_A, 'g1', {
        expenses: [makeExpenseRecord('exp-1', new Date())],
      }),
    })
    const before = await repo.database.groupMeta.get([namespace, 'g1'])
    const rowsBefore = await repo.database.expenseList.toArray()
    const confirmed = await repo.confirmGroup({
      namespace,
      generation: 0,
      groupId: 'g1',
      serverRevision: 'o2.c0.v0',
      now: new Date('2026-10-01T00:00:00.000Z'),
    })
    expect(confirmed).toEqual({ confirmed: true })
    const after = await repo.database.groupMeta.get([namespace, 'g1'])
    // Only the confirmation moves; capture, nonce, and history are pinned.
    expect(after?.lastConfirmedAt).toEqual(new Date('2026-10-01T00:00:00.000Z'))
    expect(after?.capturedAt.getTime()).toBe(before?.capturedAt.getTime())
    expect(after?.commitNonce).toBe(before?.commitNonce)
    expect(after?.serverRevision).toBe(before?.serverRevision)
    expect(await repo.database.expenseList.toArray()).toEqual(rowsBefore)
  })

  it('refuses confirmation on changed, dirty, or fenced groups', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor(ACCOUNT_A)
    await repo.ensureControl(namespace)
    await repo.replaceCatalog({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      catalog: makeCatalog(ACCOUNT_A, ['g1']),
    })
    await repo.commitGroup({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      snapshot: makeSnapshot(ACCOUNT_A, 'g1'),
    })
    // Changed token: next pass must refetch, not confirm.
    await expect(
      repo.confirmGroup({
        namespace,
        generation: 0,
        groupId: 'g1',
        serverRevision: 'o2.c99.v0',
      }),
    ).resolves.toEqual({ confirmed: false })
    // Dirty groups are never confirmed.
    await repo.markDirty({ namespace, generation: 0, dirtyGroupIds: ['g1'] })
    await expect(
      repo.confirmGroup({
        namespace,
        generation: 0,
        groupId: 'g1',
        serverRevision: 'o2.c0.v0',
      }),
    ).resolves.toEqual({ confirmed: false })
    // Missing groups and stale generations fail closed.
    await expect(
      repo.confirmGroup({
        namespace,
        generation: 0,
        groupId: 'absent',
        serverRevision: 'o2.c0.v0',
      }),
    ).resolves.toEqual({ confirmed: false })
    await expect(
      repo.confirmGroup({
        namespace,
        generation: 7,
        groupId: 'g1',
        serverRevision: 'o2.c0.v0',
      }),
    ).rejects.toMatchObject({ code: 'generation-mismatch' })
  })

  it('throws corrupt-record for malformed control rows', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor(ACCOUNT_A)
    await repo.ensureControl(namespace)

    const existing = await repo.database.controls.get(namespace)
    await repo.database.controls.put({
      ...existing!,
      generation: 'bad',
    } as never)

    await expect(
      repo.replaceCatalog({
        namespace,
        generation: 0,
        expectedDataRevision: 0,
        catalog: makeCatalog(ACCOUNT_A, ['g1']),
      }),
    ).rejects.toMatchObject({ code: 'corrupt-record' })
  })
})
