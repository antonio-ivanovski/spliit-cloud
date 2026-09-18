// NOTE: these Vitest cases run on `fake-indexeddb` mocks.
// Mocks do not prove Safari, PWA, or multi-tab IndexedDB behavior. The
// production browser matrix (installed iOS Safari, Android Chrome, desktop
// Chromium, airplane-mode relaunch, two tabs, upgrade-blocked, quota) must
// still be executed manually before release.
import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  buildNamespace,
  type GroupRecord,
} from './contract'
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
  }
}

function makeCatalog(
  accountId: string,
  groupIds: string[],
  capturedAt = new Date(),
) {
  return {
    schemaVersion: 1 as const,
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
    schemaVersion: 1 as const,
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
    expenses,
    totalCount: expenses.length,
    downloadedCount: expenses.length,
    hasMore: false,
    truncatedAt: null,
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
    expect(control.enabled).toBe(true)

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
    // Disabling fences in-flight passes by bumping generation.
    const disabled = await repo.setEnabled({
      namespace,
      generation: 0,
      enabled: false,
    })
    expect(disabled.generation).toBe(1)

    await expect(
      repo.commitGroup({
        namespace,
        generation: 0,
        expectedDataRevision: 0,
        snapshot: makeSnapshot(ACCOUNT_A, 'g1'),
      }),
    ).rejects.toMatchObject({ code: 'generation-mismatch' })
  })

  it('does not resurrect cleared data from a late response', async () => {
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

    const cleared = await repo.clearDownloads({ namespace, generation: 0 })
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

    // Corrupt the stored payload directly, bypassing commit validation.
    const raw = await openDB(OFFLINE_DB_NAME, OFFLINE_DB_VERSION)
    await raw.put('groups', {
      namespace,
      groupId: 'bad',
      schemaVersion: 1,
      capturedAt: new Date(),
      storedAt: new Date(),
      commitNonce: 'nonce-bad',
      dirtySince: null,
      payload: { bogus: true },
    } as unknown as GroupRecord)
    raw.close()

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

    const raw = await openDB(OFFLINE_DB_NAME, OFFLINE_DB_VERSION)
    await raw.put('catalog', {
      namespace,
      capturedAt: new Date(),
      groups: [{ bogus: true }],
      schemaVersion: 1,
    })
    raw.close()

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

    const raw = await openDB(OFFLINE_DB_NAME, OFFLINE_DB_VERSION)
    const existing = await raw.get('groups', [
      namespace,
      'g1',
    ] as unknown as IDBKeyRange)
    await raw.put('groups', { ...existing, schemaVersion: 99 })
    raw.close()

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

    const upgraded = await openDB(OFFLINE_DB_NAME, OFFLINE_DB_VERSION + 1, {
      upgrade(db) {
        // Keep existing stores; the version bump only exercises the
        // versionchange/blocking path.
        if (!db.objectStoreNames.contains('control')) {
          db.createObjectStore('control', { keyPath: 'namespace' })
        }
      },
    })
    // fake-indexeddb delivers versionchange asynchronously.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(onVersionChange).toHaveBeenCalled()
    upgraded.close()
    // The old connection was closed; avoid reusing it after this test.
    opened.splice(opened.indexOf(repo), 1)
    repo.close()
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

    const cleared = await repo.clearDownloads({ namespace, generation: 0 })
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

    const raw = await openDB(OFFLINE_DB_NAME, OFFLINE_DB_VERSION)
    await raw.put('catalog', {
      namespace,
      capturedAt: new Date(),
      groups: [],
    })
    await raw.put('groups', {
      namespace,
      groupId: 'g1',
      capturedAt: new Date(),
      storedAt: new Date(),
      commitNonce: 'nonce-1',
      dirtySince: null,
      payload: makeSnapshot(ACCOUNT_A, 'g1'),
    })
    raw.close()

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

  it('clears the lease on disable so re-enable allows a new owner', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor(ACCOUNT_A)
    await repo.ensureControl(namespace)
    await repo.replaceCatalog({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      catalog: makeCatalog(ACCOUNT_A, ['g1']),
    })

    const raw = await openDB(OFFLINE_DB_NAME, OFFLINE_DB_VERSION)
    const control = await raw.get('control', namespace)
    await raw.put('control', {
      ...control,
      leaseOwner: 'owner-a',
      leaseUntil: Date.now() + 30_000,
    })
    raw.close()

    const disabled = await repo.setEnabled({
      namespace,
      generation: 0,
      enabled: false,
    })
    expect(disabled.generation).toBe(1)
    const afterDisable = await repo.readControl(namespace)
    expect(afterDisable?.leaseOwner).toBeNull()
    expect(afterDisable?.leaseUntil).toBeNull()

    await repo.setEnabled({ namespace, generation: 1, enabled: true })
    const committed = await repo.commitGroup({
      namespace,
      generation: 1,
      expectedDataRevision: 0,
      snapshot: makeSnapshot(ACCOUNT_A, 'g1'),
      leaseOwner: 'owner-b',
    })
    expect(committed.commitNonce).toMatch(/.+/)
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
      const raw = await openDB(OFFLINE_DB_NAME, OFFLINE_DB_VERSION)
      const current = await raw.get('control', namespace)
      await raw.put('control', {
        ...current,
        leaseOwner: owner,
        leaseUntil: until,
      })
      raw.close()
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
    expect(group.record.schemaVersion).toBe(1)
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

  it('throws corrupt-record for malformed control rows', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor(ACCOUNT_A)
    await repo.ensureControl(namespace)

    const raw = await openDB(OFFLINE_DB_NAME, OFFLINE_DB_VERSION)
    const existing = await raw.get('control', namespace)
    await raw.put('control', { ...existing, generation: 'bad' })
    raw.close()

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
