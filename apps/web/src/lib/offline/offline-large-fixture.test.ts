import { cpus, platform, release, totalmem } from 'node:os'

import { describe, expect, it } from 'vitest'

import type { OfflineSnapshotOutput } from '@spliit/api/offline-contract'

import type { CatalogRecord, GroupRecord } from './contract'
import { runOfflineWorkerQuery } from './query-worker'
import { getOfflineBalances } from './read-model'
import {
  OFFLINE_LOCAL_PAGE_SIZE,
  queryGlobalExpensesOffline,
  queryGroupExpensesOffline,
} from './read-model'

/**
 * Large-data acceptance fixture: 20 groups, 10,000 total expenses, including
 * one group with 8,000 expenses, itemized rows, and attachment metadata. These
 * are acceptance targets, not measured production sizes.
 *
 * The fixture exercises the local query engine at scale with deterministic
 * synthetic rows (modular arithmetic, no randomness). Payloads carry full row
 * sets so the engine is measured over 10k rows; server-side 500-cap disclosure
 * (`totalCount`/`downloadedCount`/`hasMore`/`truncatedAt`) is covered by the
 * API contract tests and the capped-shape assertion below.
 *
 * Timing assertions below are real measurements of the pure in-memory engine on
 * the machine running the test (host details are printed), not browser,
 * IndexedDB, or render measurements. They do not establish production mobile
 * performance.
 */

const GROUP_COUNT = 20
const TOTAL_EXPENSES = 10_000
const BIG_GROUP_SIZE = 8_000
const WORKER_BUDGET_MS = 500

const CATEGORIES = [
  'groceries',
  'restaurant',
  'transport',
  'utilities',
  'entertainment',
  'general',
] as const

const GROUP_CURRENCIES = ['USD', 'EUR', 'JPY', 'GBP'] as const

function categoryObject(id: string) {
  return { id, grouping: 'test', name: id }
}

function expenseRecord(
  groupId: string,
  index: number,
  total: number,
  currency: string,
) {
  const id = `${groupId}-exp-${index}`
  // Tied dates (45-day cycle) and tied amounts (50-way cycle) to pin sort
  // tie-breakers at scale.
  const day = index % 45
  const expenseDate = new Date(Date.UTC(2026, 0, 1 + day, 12, 0, 0))
  const createdAt = new Date(expenseDate.getTime() + (index % 7) * 3_600_000)
  const amount = 100 + ((index * 37) % 50) * 100
  const categoryId = CATEGORIES[index % CATEGORIES.length]!
  const itemized = index % 10 === 0
  const withDocuments = index % 25 === 0
  const withNotes = index % 7 === 0
  const foreign = index % 3 === 0 && currency !== 'USD'
  const involvesMe = index % 2 === 0
  const list = {
    id,
    title: `Expense ${index} ${categoryId}`,
    amount,
    expenseDate,
    expenseTimeZone: 'UTC',
    categoryId,
    category: categoryObject(categoryId),
    splitMode: itemized ? 'ITEMIZED' : 'EVENLY',
    paidBySplitMode: 'EVENLY',
    originalAmount: foreign ? amount * 2 : null,
    originalCurrency: foreign ? 'USD' : null,
    conversionRate: foreign ? 0.5 : null,
    conversionSource: foreign ? 'EXCHANGE' : null,
    originType: null,
    recurrenceSequence: null,
    items: itemized
      ? [
          { id: `${id}-item-0`, title: `Item zero ${index}` },
          { id: `${id}-item-1`, title: `Item one ${index}` },
        ]
      : [],
    createdAt,
    // Wire-shaped payer/beneficiary rows: the engine resolves involvement
    // through `ledgerParticipant.id` (removed/unlinked identities keep it).
    paidByList: [{ ledgerParticipant: { id: index % 4 === 0 ? 'me' : 'p0' } }],
    paidFor: [{ ledgerParticipant: { id: involvesMe ? 'me' : 'p1' } }],
    recurringSeriesId: null,
    recurringSeriesStatus: null,
    documentCount: withDocuments ? 1 : 0,
    permissions: {
      canEdit: false,
      canDelete: false,
      canManageRecurrence: false,
    },
  }
  const detail = {
    ...list,
    version: 1,
    notes: withNotes ? `Note ${index} coffee receipt` : null,
    documents: withDocuments
      ? [
          {
            id: `${id}-doc`,
            fileName: `receipt-${index}.jpg`,
            contentType: 'image/jpeg',
            width: 800,
            height: 600,
          },
        ]
      : [],
    itemizedRemainder: itemized ? 0 : null,
    recurringSeries: null,
    recurrence: null,
    previousExpenseId: null,
    nextExpenseId: null,
  }
  return { list, detail, total, index }
}

function snapshotPayload(
  groupId: string,
  size: number,
  currency: string,
): OfflineSnapshotOutput {
  const expenses = Array.from({ length: size }, (_, index) =>
    expenseRecord(groupId, index, size, currency),
  )
  const stamp = new Date('2026-06-01T12:00:00.000Z')
  return {
    schemaVersion: 1,
    accountId: 'account-large',
    groupId,
    capturedAt: stamp,
    group: {
      group: { participants: [], members: [] },
      displayName: groupId,
      currentLedgerParticipantId: null,
      currentMember: null,
      currentInvitation: null,
      linkInviteState: null,
      viewer: {
        source: 'MEMBER',
        access: 'READ_WRITE',
        canMutate: true,
        canAcceptInvitation: false,
      },
      hasSavedView: false,
    },
    overview: {
      id: groupId,
      name: groupId,
      information: null,
      archived: false,
      createdAt: stamp.toISOString(),
      groupType: 'GROUP',
      ledger: { currency, currencyCode: currency },
      memberCount: 2,
      currentMemberRole: 'MEMBER',
      preference: { starred: false, hidden: false },
      displayName: groupId,
      friendAccount: null,
      memberAccounts: [],
      financialSummary: {
        expenseCount: size,
        netBalance: 0,
        state: size === 0 ? 'NO_EXPENSES' : 'SETTLED',
        latestExpenseCreatedAt: null,
      },
      access: 'MEMBER',
      viewKey: null,
      lastOpenedAt: null,
    },
    global: {
      id: groupId,
      name: groupId,
      archived: false,
      hidden: false,
      groupType: 'GROUP',
      displayName: groupId,
      currency,
      currencyCode: currency,
      participantCount: 2,
    },
    balances: {
      balances: {},
      suggestedSettlements: [],
      currencyBalances: [],
      participants: [],
      settlement: {
        subgroup: { units: [], legs: [], hasInternalBalances: false },
        individual: { suggestedSettlements: [], policy: 'standard' },
      },
    },
    expenses,
    totalCount: size,
    downloadedCount: size,
    hasMore: false,
    truncatedAt: null,
  } as unknown as OfflineSnapshotOutput
}

function buildLargeFixture() {
  // One 8k group; the remaining 2k spread over 19 groups.
  const sizes = [BIG_GROUP_SIZE]
  const rest = TOTAL_EXPENSES - BIG_GROUP_SIZE
  for (let i = 1; i < GROUP_COUNT; i += 1) {
    sizes.push(i === GROUP_COUNT - 1 ? rest - 105 * (GROUP_COUNT - 2) : 105)
  }
  const byGroupId = new Map<string, GroupRecord>()
  const catalogGroups: CatalogRecord['groups'] = []
  sizes.forEach((size, position) => {
    const groupId = `large-g${String(position).padStart(2, '0')}`
    const currency = GROUP_CURRENCIES[position % GROUP_CURRENCIES.length]!
    const payload = snapshotPayload(groupId, size, currency)
    // One archived and one hidden group: the global default view excludes
    // them exactly like the server does.
    if (position === GROUP_COUNT - 2) {
      payload.global = { ...payload.global, archived: true }
      payload.overview = { ...payload.overview, archived: true }
    }
    if (position === GROUP_COUNT - 1) {
      payload.global = { ...payload.global, hidden: true }
      payload.overview = {
        ...payload.overview,
        preference: { starred: false, hidden: true },
      }
    }
    byGroupId.set(groupId, {
      namespace: 'ns-large',
      groupId,
      schemaVersion: 1,
      capturedAt: new Date('2026-06-01T12:00:00.000Z'),
      storedAt: new Date('2026-06-01T12:00:01.000Z'),
      commitNonce: `nonce-${groupId}`,
      dirtySince: null,
      payload,
    })
    catalogGroups.push({
      overview: payload.overview,
      global: payload.global,
    } as unknown as CatalogRecord['groups'][number])
  })
  const catalog: CatalogRecord = {
    namespace: 'ns-large',
    capturedAt: new Date('2026-06-01T12:00:00.000Z'),
    schemaVersion: 1,
    groups: catalogGroups,
  }
  return { catalog, byGroupId, bigGroupId: 'large-g00', sizes }
}

function deviceLabel(): string {
  const cpu = cpus()[0]?.model ?? 'unknown-cpu'
  const gb = (totalmem() / 1024 ** 3).toFixed(1)
  return `${platform()} ${release()} | ${cpu} | ${gb} GiB RAM`
}

function timed<T>(label: string, fn: () => T): { result: T; ms: number } {
  const start = performance.now()
  const result = fn()
  const ms = performance.now() - start
  // eslint-disable-next-line no-console -- benchmark record, not diagnostics.
  console.info(`[offline-large-fixture] ${label}: ${ms.toFixed(1)}ms`)
  return { result, ms }
}

describe('offline large-data acceptance fixture', () => {
  it('holds 20 groups with 10k total expenses including one 8k group', () => {
    const { catalog, byGroupId, sizes } = buildLargeFixture()
    expect(catalog.groups).toHaveLength(GROUP_COUNT)
    expect(byGroupId.size).toBe(GROUP_COUNT)
    const total = sizes.reduce((sum, size) => sum + size, 0)
    expect(total).toBe(TOTAL_EXPENSES)
    expect(sizes[0]).toBe(BIG_GROUP_SIZE)
    let rows = 0
    let itemized = 0
    let withDocuments = 0
    for (const record of byGroupId.values()) {
      rows += record.payload.expenses.length
      for (const entry of record.payload.expenses) {
        if ((entry.list as { splitMode?: string }).splitMode === 'ITEMIZED') {
          itemized += 1
          expect(entry.list.items.length).toBeGreaterThan(0)
        }
        const docs = entry.detail.documents as Array<{
          id: string
          fileName: string | null
        }>
        if (docs.length > 0) {
          withDocuments += 1
          // Attachment metadata only: ids/names/types, never a URL.
          expect(Object.keys(docs[0]!).sort()).toEqual([
            'contentType',
            'fileName',
            'height',
            'id',
            'width',
          ])
          expect(entry.list.documentCount).toBe(docs.length)
        }
      }
      // No silent caps on the fixture payloads: counts disclose the full set.
      expect(record.payload.totalCount).toBe(record.payload.expenses.length)
      expect(record.payload.downloadedCount).toBe(
        record.payload.expenses.length,
      )
      expect(record.payload.hasMore).toBe(false)
    }
    expect(rows).toBe(TOTAL_EXPENSES)
    expect(itemized).toBeGreaterThan(0)
    expect(withDocuments).toBeGreaterThan(0)
  })

  it('paginates the 8k group end-to-end without omissions or duplicates', () => {
    const { byGroupId, bigGroupId } = buildLargeFixture()
    const payload = byGroupId.get(bigGroupId)!.payload
    const seen = new Set<string>()
    let offset = 0
    let pages = 0
    for (;;) {
      const page = queryGroupExpensesOffline(payload, { offset })
      expect(page.rows).toHaveLength(
        Math.min(OFFLINE_LOCAL_PAGE_SIZE, BIG_GROUP_SIZE - offset),
      )
      for (const row of page.rows) seen.add(row.list.id)
      pages += 1
      if (!page.hasMore || page.nextOffset == null) break
      offset = page.nextOffset
    }
    expect(seen.size).toBe(BIG_GROUP_SIZE)
    expect(pages).toBe(BIG_GROUP_SIZE / OFFLINE_LOCAL_PAGE_SIZE)
  })

  it('unions all ready groups globally with server-matching hidden/archive defaults', () => {
    const { catalog, byGroupId } = buildLargeFixture()
    const result = queryGlobalExpensesOffline(catalog, byGroupId, {})
    const excluded = 105 + (TOTAL_EXPENSES - BIG_GROUP_SIZE - 105 * 18)
    expect(result.totalFiltered).toBe(TOTAL_EXPENSES - excluded)
    expect(result.incompleteGroupCount).toBe(0)
    const withArchived = queryGlobalExpensesOffline(catalog, byGroupId, {
      includeArchived: true,
    })
    expect(withArchived.totalFiltered).toBeGreaterThan(result.totalFiltered)
  })

  it('discloses the 500-cap through balances metadata (no silent truncation)', () => {
    const { byGroupId, bigGroupId } = buildLargeFixture()
    const record = byGroupId.get(bigGroupId)!
    // A capped server payload carries 500 rows with disclosure flags; the
    // balances view (full-ledger correct) surfaces hasMore/totalCount.
    const capped = {
      ...record,
      payload: {
        ...record.payload,
        expenses: record.payload.expenses.slice(0, 500),
        totalCount: BIG_GROUP_SIZE,
        downloadedCount: 500,
        hasMore: true,
        truncatedAt: record.payload.capturedAt,
      },
    } as GroupRecord
    const view = getOfflineBalances(capped)
    expect(view.hasMore).toBe(true)
    expect(view.totalCount).toBe(BIG_GROUP_SIZE)
    expect(capped.payload.downloadedCount).toBe(500)
  })

  it('answers large-fixture queries within the 500ms worker budget', () => {
    // eslint-disable-next-line no-console -- benchmark record, not diagnostics.
    console.info(`[offline-large-fixture] host: ${deviceLabel()}`)
    const { catalog, byGroupId, bigGroupId } = buildLargeFixture()
    const big = byGroupId.get(bigGroupId)!
    const snapshots = Array.from(byGroupId.values())

    const group = timed('group-expenses/8k filter+sort+page', () =>
      runOfflineWorkerQuery({
        requestId: 'bench-group',
        generation: 1,
        namespace: 'ns-large',
        kind: 'group-expenses',
        groupId: bigGroupId,
        filter: { search: 'Expense' },
        snapshot: big,
      }),
    )
    expect((group.result as { totalFiltered: number }).totalFiltered).toBe(
      BIG_GROUP_SIZE,
    )
    expect(group.ms).toBeLessThan(WORKER_BUDGET_MS)

    const search = timed('global-expenses/10k search', () =>
      runOfflineWorkerQuery({
        requestId: 'bench-search',
        generation: 1,
        namespace: 'ns-large',
        kind: 'global-expenses',
        filter: { search: 'coffee' },
        catalog,
        snapshots,
      }),
    )
    expect(
      (search.result as { totalFiltered: number }).totalFiltered,
    ).toBeGreaterThan(0)
    expect(search.ms).toBeLessThan(WORKER_BUDGET_MS)

    const collapse = timed('group-expenses/8k involvement collapse', () =>
      runOfflineWorkerQuery({
        requestId: 'bench-collapse',
        generation: 1,
        namespace: 'ns-large',
        kind: 'group-expenses',
        groupId: bigGroupId,
        collapseInvolving: true,
        participantId: 'me',
        snapshot: big,
      }),
    )
    expect(
      (collapse.result as { rows: unknown[] }).rows.length,
    ).toBeLessThanOrEqual(OFFLINE_LOCAL_PAGE_SIZE + 100)
    expect(collapse.ms).toBeLessThan(WORKER_BUDGET_MS)
  })
})
