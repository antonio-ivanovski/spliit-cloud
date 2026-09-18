import type {
  OfflineCatalogEntry,
  OfflineSnapshotOutput,
} from '@spliit/api/offline-contract'
import {
  SETTLEMENT_CATEGORY_ID,
  expandCategorySelection,
  expandExpenseQueryForLocale,
} from '@spliit/domain'

import type { CatalogRecord, GroupRecord } from './contract'

/**
 * Offline read model.
 *
 * Pure local query engine over committed snapshots. No React, no IndexedDB, no
 * network. The same functions run in the dedicated Web Worker
 * (`query-worker.ts`) and in the chunked main-thread fallback, so search,
 * filter, sort, and pagination stay identical in both paths.
 *
 * Snapshot cap (user amendment): at most 500 newest expenses per group
 * (expenseDate desc, createdAt desc, id desc). The server sends `totalCount`,
 * `downloadedCount`, `hasMore`, and `truncatedAt`; this module never invents
 * missing rows and surfaces the recent-500 boundary in copy.
 */

export const OFFLINE_LOCAL_PAGE_SIZE = 20
export const OFFLINE_INVOLVEMENT_HIDDEN_CAP = 100
export const OFFLINE_SNAPSHOT_CAP = 500
/** Yield back to the main thread every N rows in the fallback path. */
export const OFFLINE_FALLBACK_CHUNK_ROWS = 500

export const OFFLINE_COPY = {
  expenseMissing:
    "This expense isn't in this device's download. Reconnect to check for newer/older expenses.",
  groupMissing: "This group hasn't finished downloading.",
  recent500: (totalCount: number) =>
    `Showing recent 500 of ${totalCount}. Reconnect for older.`,
  balancesStale: 'Balances may be out of date.',
  totalsIncomplete: 'Reconnect to update totals.',
  offlineSearchHint:
    'Offline search uses exact text; typo matching needs a connection.',
} as const

export type OfflineSource = 'network' | 'download'
export type OfflineAvailability =
  | 'loading'
  | 'ready'
  | 'missing'
  | 'error'
  | 'unsupported'

export type OfflineReadMeta = {
  source: OfflineSource
  capturedAt: Date | null
  availability: OfflineAvailability
  refreshing: boolean
  incompleteGroupCount: number
  hasMore?: boolean
  totalCount?: number
  truncatedGroupCount?: number
}

export function emptyMeta(
  overrides?: Partial<OfflineReadMeta>,
): OfflineReadMeta {
  return {
    source: 'download',
    capturedAt: null,
    availability: 'loading',
    refreshing: false,
    incompleteGroupCount: 0,
    ...overrides,
  }
}

/**
 * Disjoint local query-key prefix. `version` must be
 * `${storedAt.getTime()}:${commitNonce}` (never the server timestamp alone) so
 * a same-second recommit still resets pagination.
 */
export function offlineQueryKey(
  namespace: string,
  generation: number,
  version: string,
  ...rest: unknown[]
): unknown[] {
  return ['offline', namespace, generation, version, ...rest]
}

export function snapshotVersion(
  record: Pick<GroupRecord, 'storedAt' | 'commitNonce'>,
): string {
  const storedAtMs =
    record.storedAt instanceof Date
      ? record.storedAt.getTime()
      : new Date(record.storedAt).getTime()
  return `${storedAtMs}:${record.commitNonce}`
}

export type OfflineExpenseRecord = OfflineSnapshotOutput['expenses'][number]
export type OfflineListItem = OfflineExpenseRecord['list']
export type OfflineDetail = OfflineExpenseRecord['detail']

export type GroupExpenseSortBy = 'expenseDate' | 'createdAt' | 'amount'
export type GroupExpenseSortDir = 'asc' | 'desc'
export type MatchMode = 'any' | 'all' | 'exact'

export type GroupExpenseFilter = {
  hideSettlements?: boolean
  categories?: string[]
  paidBy?: string[]
  paidByMatch?: MatchMode
  paidFor?: string[]
  paidForMatch?: MatchMode
  dateFrom?: Date
  dateTo?: Date
  minAmount?: number
  maxAmount?: number
  /** Group scope: matches `originalCurrency` (distinct from global base key). */
  currencies?: string[]
  search?: string
  locale?: string
}

export type GlobalPersonRef =
  | { kind: 'account'; id: string }
  | { kind: 'participant'; id: string; groupId: string }

export type GlobalExpenseFilter = {
  groupIds?: string[]
  includeArchived?: boolean
  hideSettlements?: boolean
  categories?: string[]
  paidBy?: GlobalPersonRef[]
  paidByMatch?: MatchMode
  paidFor?: GlobalPersonRef[]
  paidForMatch?: MatchMode
  dateFrom?: Date
  dateTo?: Date
  minAmount?: number
  maxAmount?: number
  /** Global scope: base-currency keys (`currencyCode:currency`). */
  currencies?: string[]
  search?: string
  locale?: string
  sortBy?: GroupExpenseSortBy
  sortDir?: GroupExpenseSortDir
}

function toTime(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}

function normalizeSearchText(value: string | undefined): string {
  return (value ?? '').trim()
}

/** Minimal involvement wire shape (list-level payer-or-beneficiary). */
export type InvolvementLike = {
  paidByList: Array<{
    ledgerParticipant: { id: string; account?: { id: string } | null }
  }>
  paidFor: Array<{
    ledgerParticipant: { id: string; account?: { id: string } | null }
  }>
}

export function isExpenseInvolvingLocal(
  expense: InvolvementLike,
  participantId: string | null | undefined,
  accountId: string | null | undefined,
): boolean {
  if (!participantId && !accountId) return true
  const sides = [...expense.paidByList, ...expense.paidFor]
  return sides.some(
    (side) =>
      (participantId != null && side.ledgerParticipant.id === participantId) ||
      (accountId != null && side.ledgerParticipant.account?.id === accountId),
  )
}

/**
 * Memoized category expansion for text search. The expansion depends only on
 * the (query, locale) pair, but matchers run it once per candidate row; on the
 * 10k-row acceptance fixture the uncached fuzzy lookup dominates query time
 * (>2s). The cache is bounded and keyed by the normalized pair, so repeated
 * keystrokes and paged queries reuse one lookup per query text.
 */
const categoryExpansionCache = new Map<string, string[]>()
const CATEGORY_EXPANSION_CACHE_LIMIT = 50

function categoryExpansionForSearch(query: string, locale?: string): string[] {
  const trimmed = query.trim()
  if (!trimmed) return []
  const key = `${locale ?? 'en-US'}::${trimmed.toLowerCase()}`
  const cached = categoryExpansionCache.get(key)
  if (cached) return cached
  let expanded: string[] = []
  try {
    expanded =
      expandExpenseQueryForLocale(trimmed, locale ?? 'en-US').categoryIds ?? []
  } catch {
    expanded = []
  }
  categoryExpansionCache.set(key, expanded)
  if (categoryExpansionCache.size > CATEGORY_EXPANSION_CACHE_LIMIT) {
    const oldest = categoryExpansionCache.keys().next()
    if (!oldest.done) categoryExpansionCache.delete(oldest.value)
  }
  return expanded
}

/**
 * Group text scope: trimmed case-insensitive substring on title plus localized
 * category expansion. No accent/stemming/typo/ranking/network.
 */
export function matchesGroupSearch(
  list: OfflineListItem,
  query: string | undefined,
  locale?: string,
): boolean {
  const trimmed = normalizeSearchText(query)
  if (!trimmed) return true
  const lowered = trimmed.toLowerCase()
  if (list.title.toLowerCase().includes(lowered)) return true
  const expanded = categoryExpansionForSearch(trimmed, locale)
  if (expanded.length > 0 && expanded.includes(list.categoryId)) return true
  return false
}

/**
 * Global text scope: group scope plus notes/item-title substring, matching the
 * current non-fuzzy server scopes (`title`, `notes`, `items.title`,
 * `categoryId`). No trigram similarity offline.
 */
export function matchesGlobalSearch(
  list: OfflineListItem,
  detail: OfflineDetail | null,
  query: string | undefined,
  locale?: string,
): boolean {
  const trimmed = normalizeSearchText(query)
  if (!trimmed) return true
  const lowered = trimmed.toLowerCase()
  if (list.title.toLowerCase().includes(lowered)) return true
  const notes = detail?.notes ?? null
  if (notes && notes.toLowerCase().includes(lowered)) return true
  const items = detail?.items ?? list.items ?? []
  for (const item of items) {
    const title = (item as { title?: unknown }).title
    if (typeof title === 'string' && title.toLowerCase().includes(lowered)) {
      return true
    }
  }
  const expanded = categoryExpansionForSearch(trimmed, locale)
  if (expanded.length > 0 && expanded.includes(list.categoryId)) return true
  return false
}

function matchesParticipantSet(
  sides: Array<{ ledgerParticipant: { id: string } }>,
  selected: string[] | undefined,
  match: MatchMode | undefined,
): boolean {
  if (!selected || selected.length === 0) return true
  const present = new Set(sides.map((side) => side.ledgerParticipant.id))
  const mode = match ?? 'any'
  if (mode === 'any') return selected.some((id) => present.has(id))
  if (mode === 'all') return selected.every((id) => present.has(id))
  // exact: every selected present and nothing else present.
  return (
    selected.every((id) => present.has(id)) &&
    [...present].every((id) => selected.includes(id))
  )
}

function inDateBounds(
  expenseDate: Date | string,
  from?: Date,
  to?: Date,
): boolean {
  const time = toTime(expenseDate)
  // Inclusive bounds; invalid filter dates are ignored by callers that parse
  // URL state (existing UI normalization preserved).
  if (from && Number.isFinite(from.getTime()) && time < from.getTime()) {
    return false
  }
  if (to && Number.isFinite(to.getTime()) && time > to.getTime()) {
    return false
  }
  return true
}

function inAmountBounds(amount: number, min?: number, max?: number): boolean {
  if (min !== undefined && Number.isFinite(min) && amount < min) return false
  if (max !== undefined && Number.isFinite(max) && amount > max) return false
  return true
}

/**
 * Group filter semantics mirror `getGroupExpenses`: explicit categories
 * override hideSettlements; currencies match `originalCurrency`; date/amount
 * bounds inclusive; any/all/exact preserved.
 */
export function applyGroupFilters(
  records: OfflineExpenseRecord[],
  filter: GroupExpenseFilter,
): OfflineExpenseRecord[] {
  const hasExplicitCategories =
    !!filter.categories && filter.categories.length > 0
  const expandedCategories = hasExplicitCategories
    ? expandCategorySelection(filter.categories ?? [])
    : []
  return records.filter((record) => {
    const list = record.list
    if (hasExplicitCategories) {
      const accepted =
        expandedCategories.length > 0
          ? expandedCategories.includes(list.categoryId)
          : (filter.categories ?? []).includes(list.categoryId)
      if (!accepted) return false
    } else if (filter.hideSettlements) {
      if (list.categoryId === SETTLEMENT_CATEGORY_ID) return false
    }
    if (
      filter.currencies &&
      filter.currencies.length > 0 &&
      !filter.currencies.includes(list.originalCurrency ?? '')
    ) {
      // `originalCurrency` null never matches an explicit currency filter.
      return false
    }
    if (!inDateBounds(list.expenseDate, filter.dateFrom, filter.dateTo)) {
      return false
    }
    if (!inAmountBounds(list.amount, filter.minAmount, filter.maxAmount)) {
      return false
    }
    if (
      !matchesParticipantSet(list.paidByList, filter.paidBy, filter.paidByMatch)
    ) {
      return false
    }
    if (
      !matchesParticipantSet(list.paidFor, filter.paidFor, filter.paidForMatch)
    ) {
      return false
    }
    if (!matchesGroupSearch(list, filter.search, filter.locale)) return false
    return true
  })
}

function compareDates(a: Date | string, b: Date | string): number {
  return toTime(a) - toTime(b)
}

/**
 * Group sort: expenseDate primary selected dir then createdAt desc id desc;
 * createdAt/amount primary selected dir then id desc. Equal timestamps/amounts
 * fall through to the fixed desc tie-breakers.
 */
export function sortGroupRecords(
  records: OfflineExpenseRecord[],
  sortBy?: GroupExpenseSortBy,
  sortDir?: GroupExpenseSortDir,
): OfflineExpenseRecord[] {
  const field = sortBy ?? 'expenseDate'
  const dir = sortDir ?? 'desc'
  const primary = dir === 'asc' ? 1 : -1
  return [...records].sort((a, b) => {
    if (field === 'expenseDate') {
      const diff = compareDates(a.list.expenseDate, b.list.expenseDate)
      if (diff !== 0) return diff * primary
      const createdDiff = compareDates(a.list.createdAt, b.list.createdAt)
      if (createdDiff !== 0) return createdDiff > 0 ? 1 : -1
      return a.list.id < b.list.id ? 1 : a.list.id > b.list.id ? -1 : 0
    }
    if (field === 'createdAt') {
      const diff = compareDates(a.list.createdAt, b.list.createdAt)
      if (diff !== 0) return diff * primary
      return a.list.id < b.list.id ? 1 : a.list.id > b.list.id ? -1 : 0
    }
    if (a.list.amount !== b.list.amount) {
      return (a.list.amount - b.list.amount) * primary
    }
    return a.list.id < b.list.id ? 1 : a.list.id > b.list.id ? -1 : 0
  })
}

/**
 * Global sort: selected primary and all tie-breakers follow the selected dir;
 * expenseDate has createdAt then id.
 */
export function sortGlobalRecords(
  records: Array<OfflineExpenseRecord & { groupId: string }>,
  sortBy?: GroupExpenseSortBy,
  sortDir?: GroupExpenseSortDir,
): Array<OfflineExpenseRecord & { groupId: string }> {
  const field = sortBy ?? 'expenseDate'
  const dir = sortDir ?? 'desc'
  const primary = dir === 'asc' ? 1 : -1
  return [...records].sort((a, b) => {
    if (field === 'expenseDate') {
      const diff = compareDates(a.list.expenseDate, b.list.expenseDate)
      if (diff !== 0) return diff * primary
      const createdDiff = compareDates(a.list.createdAt, b.list.createdAt)
      if (createdDiff !== 0) return createdDiff * primary
      if (a.list.id === b.list.id) return 0
      return (a.list.id < b.list.id ? -1 : 1) * primary
    }
    if (field === 'createdAt') {
      const diff = compareDates(a.list.createdAt, b.list.createdAt)
      if (diff !== 0) return diff * primary
      if (a.list.id === b.list.id) return 0
      return (a.list.id < b.list.id ? -1 : 1) * primary
    }
    if (a.list.amount !== b.list.amount) {
      return (a.list.amount - b.list.amount) * primary
    }
    if (a.list.id === b.list.id) return 0
    return (a.list.id < b.list.id ? -1 : 1) * primary
  })
}

export type LocalPage<T> = {
  rows: T[]
  nextOffset: number | null
  hasMore: boolean
}

export function paginateLocal<T>(
  rows: T[],
  offset: number,
  limit = OFFLINE_LOCAL_PAGE_SIZE,
): LocalPage<T> {
  const safeOffset = Math.max(0, offset)
  const page = rows.slice(safeOffset, safeOffset + limit)
  const nextOffset =
    safeOffset + limit < rows.length ? safeOffset + limit : null
  return { rows: page, nextOffset, hasMore: nextOffset !== null }
}

export type InvolvementPage = {
  rows: OfflineExpenseRecord[]
  /** Array offset where the next local page starts; null when exhausted. */
  nextOffset: number | null
  hasMore: boolean
  involvingReturned: number
  hiddenPending: boolean
}

/**
 * Collapsed involvement pagination over an already sorted+filtered array.
 *
 * Consume until 20 involving rows plus intervening hidden rows, capped at 100
 * hidden rows per delivery. Hidden runs are preserved; the next page continues
 * at the exact array offset so there are no omissions or duplicates. No server
 * cursor encoding is reused locally.
 */
export function paginateInvolvementLocal(
  sorted: OfflineExpenseRecord[],
  startIndex: number,
  participantId: string | null | undefined,
  accountId: string | null | undefined,
  limit = OFFLINE_LOCAL_PAGE_SIZE,
  hiddenCap = OFFLINE_INVOLVEMENT_HIDDEN_CAP,
): InvolvementPage {
  const start = Math.max(0, startIndex)
  if (start >= sorted.length) {
    return {
      rows: [],
      nextOffset: null,
      hasMore: false,
      involvingReturned: 0,
      hiddenPending: false,
    }
  }
  const rows: OfflineExpenseRecord[] = []
  let involvingReturned = 0
  let index = start
  let trailingHidden = 0
  // Phase 1: consume until `limit` involving rows (including intervening
  // hidden). Phase 2: include trailing hidden up to `hiddenCap` until the next
  // involving row (exclusive) or the cap.
  while (index < sorted.length && involvingReturned < limit) {
    const record = sorted[index]!
    rows.push(record)
    if (isExpenseInvolvingLocal(record.list, participantId, accountId)) {
      involvingReturned += 1
    }
    index += 1
  }
  if (involvingReturned === limit) {
    trailingHidden = 0
    while (
      index < sorted.length &&
      trailingHidden < hiddenCap &&
      !isExpenseInvolvingLocal(sorted[index]!.list, participantId, accountId)
    ) {
      rows.push(sorted[index]!)
      index += 1
      trailingHidden += 1
    }
    const hiddenPending =
      index < sorted.length &&
      trailingHidden >= hiddenCap &&
      !isExpenseInvolvingLocal(sorted[index]!.list, participantId, accountId)
    const hasMore = index < sorted.length
    return {
      rows,
      nextOffset: hasMore ? index : null,
      hasMore,
      involvingReturned,
      hiddenPending,
    }
  }
  // Fewer than `limit` involving rows remain: paginate the tail in hiddenCap
  // chunks so a large hidden tail never delivers unbounded rows. Each chunk
  // carries hasMore/nextOffset until exhausted.
  if (rows.length <= hiddenCap) {
    return {
      rows,
      nextOffset: null,
      hasMore: false,
      involvingReturned,
      hiddenPending: false,
    }
  }
  const sliced = rows.slice(0, hiddenCap)
  let slicedInvolving = 0
  for (const entry of sliced) {
    if (isExpenseInvolvingLocal(entry.list, participantId, accountId)) {
      slicedInvolving += 1
    }
  }
  const tailNextOffset = start + hiddenCap
  const tailHasMore = tailNextOffset < sorted.length
  return {
    rows: sliced,
    nextOffset: tailHasMore ? tailNextOffset : null,
    hasMore: tailHasMore,
    involvingReturned: slicedInvolving,
    hiddenPending:
      tailHasMore &&
      !isExpenseInvolvingLocal(
        sorted[tailNextOffset]!.list,
        participantId,
        accountId,
      ),
  }
}

export type GroupQueryResult = {
  rows: OfflineExpenseRecord[]
  totalFiltered: number
  nextOffset: number | null
  hasMore: boolean
  involvingReturned?: number
  hiddenPending?: boolean
}

/**
 * Combined group query: filter -> sort -> paginate. Plain lists use local
 * offsets; collapsed involvement mode consumes until 20 involving + capped
 * hidden. Reset pagination (offset 0) when query/filter/sort/source changes;
 * callers key pages by the source-version string.
 */
export function queryGroupExpensesOffline(
  snapshot: OfflineSnapshotOutput,
  options: {
    filter?: GroupExpenseFilter
    sortBy?: GroupExpenseSortBy
    sortDir?: GroupExpenseSortDir
    offset?: number
    limit?: number
    collapseInvolving?: boolean
    participantId?: string | null
    accountId?: string | null
  } = {},
): GroupQueryResult {
  const filtered = applyGroupFilters(snapshot.expenses, options.filter ?? {})
  const sorted = sortGroupRecords(filtered, options.sortBy, options.sortDir)
  if (options.collapseInvolving) {
    const page = paginateInvolvementLocal(
      sorted,
      options.offset ?? 0,
      options.participantId ?? null,
      options.accountId ?? null,
      options.limit ?? OFFLINE_LOCAL_PAGE_SIZE,
    )
    return {
      rows: page.rows,
      totalFiltered: filtered.length,
      nextOffset: page.nextOffset,
      hasMore: page.hasMore,
      involvingReturned: page.involvingReturned,
      hiddenPending: page.hiddenPending,
    }
  }
  const page = paginateLocal(
    sorted,
    options.offset ?? 0,
    options.limit ?? OFFLINE_LOCAL_PAGE_SIZE,
  )
  return {
    rows: page.rows,
    totalFiltered: filtered.length,
    nextOffset: page.nextOffset,
    hasMore: page.hasMore,
  }
}

export type OfflineExpenseLookup = {
  status: 'found' | 'missing'
  list?: OfflineListItem
  /** Attachment-metadata variant: ids/names/types only, never a URL. */
  detail?: OfflineDetail
  previousExpenseId?: string | null
  nextExpenseId?: string | null
  previousAvailable?: boolean
  nextAvailable?: boolean
  /** Full-series neighbor ids even when the neighbor is beyond the 500 cap. */
  seriesExpenseIds?: string[]
}

/**
 * Expense detail within the capped snapshot. A missing id is not proof of
 * server deletion — callers show `OFFLINE_COPY.expenseMissing`, which covers
 * both never-downloaded details and rows beyond the recent-500 cap. Recurrence
 * neighbors use the stored series order; neighbors beyond the cap are disclosed
 * via `previousAvailable`/`nextAvailable`.
 */
export function getOfflineExpense(
  snapshot: OfflineSnapshotOutput,
  expenseId: string,
): OfflineExpenseLookup {
  const record = snapshot.expenses.find(
    (entry) => entry.list.id === expenseId || entry.detail.id === expenseId,
  )
  if (!record) return { status: 'missing' }
  const byId = new Map(snapshot.expenses.map((entry) => [entry.list.id, entry]))
  const previousExpenseId = record.detail.previousExpenseId ?? null
  const nextExpenseId = record.detail.nextExpenseId ?? null
  let seriesExpenseIds: string[] | undefined
  const seriesId =
    (record.detail as { recurringSeriesId?: string | null })
      .recurringSeriesId ??
    (record.list as { recurringSeriesId?: string | null }).recurringSeriesId ??
    null
  if (seriesId) {
    seriesExpenseIds = snapshot.expenses
      .filter(
        (entry) =>
          ((entry.detail as { recurringSeriesId?: string | null })
            .recurringSeriesId ??
            (entry.list as { recurringSeriesId?: string | null })
              .recurringSeriesId) === seriesId,
      )
      .sort(
        (a, b) =>
          (a.detail.recurrenceSequence ?? Number.MAX_SAFE_INTEGER) -
          (b.detail.recurrenceSequence ?? Number.MAX_SAFE_INTEGER),
      )
      .map((entry) => entry.list.id)
  }
  return {
    status: 'found',
    list: record.list,
    detail: record.detail,
    previousExpenseId,
    nextExpenseId,
    previousAvailable: previousExpenseId
      ? byId.has(previousExpenseId)
      : undefined,
    nextAvailable: nextExpenseId ? byId.has(nextExpenseId) : undefined,
    seriesExpenseIds,
  }
}

export type OfflineBalancesView = {
  balances: OfflineSnapshotOutput['balances']
  capturedAt: Date
  dirtySince: Date | null
  hasMore: boolean
  totalCount: number
}

/**
 * Group balances render the stored server response (full-ledger correct, not
 * capped). The 500 cap applies to expense rows only. Callers label `dirtySince
 * != null` with `OFFLINE_COPY.balancesStale`, mandatory after a locally applied
 * delete until a coherent refresh commits.
 */
export function getOfflineBalances(record: GroupRecord): OfflineBalancesView {
  return {
    balances: record.payload.balances,
    capturedAt: record.capturedAt,
    dirtySince: record.dirtySince,
    hasMore: record.payload.hasMore,
    totalCount: record.payload.totalCount,
  }
}

export type OfflineGroupView = {
  group: OfflineSnapshotOutput['group']
  overview: OfflineSnapshotOutput['overview']
  global: OfflineSnapshotOutput['global']
  capturedAt: Date
  storedAt: Date
  commitNonce: string
  dirtySince: Date | null
  hasMore: boolean
  totalCount: number
  downloadedCount: number
}

export function toOfflineGroupView(record: GroupRecord): OfflineGroupView {
  return {
    group: record.payload.group,
    overview: record.payload.overview,
    global: record.payload.global,
    capturedAt: record.capturedAt,
    storedAt: record.storedAt,
    commitNonce: record.commitNonce,
    dirtySince: record.dirtySince,
    hasMore: record.payload.hasMore,
    totalCount: record.payload.totalCount,
    downloadedCount: record.payload.downloadedCount,
  }
}

// --- Overview ---------------------------------------------------------------

export type OverviewBalanceSummary = {
  currency: string
  currencyCode: string | null
  owedToYou: number
  owedToYouGroupCount: number
  youOwe: number
  youOweGroupCount: number
}

export type OverviewPeopleBalance = {
  key: string
  name: string
  account: { id: string; name: string; image: string | null } | null
  currencies: Array<{
    currency: string
    currencyCode: string | null
    netAmount: number
    groups: Array<{ groupId: string; groupName: string; amount: number }>
  }>
}

/**
 * Pure account-totals helper extracted from the existing overview route
 * (`summarizeBalances`): sums ready-group net balances by ledger currency.
 * Operates on stored overview entries only; never on filtered list pages.
 */
export function summarizeOfflineBalances(
  groups: Array<{
    ledger: { currency: string; currencyCode: string | null }
    financialSummary: { netBalance: number | null }
  }>,
): OverviewBalanceSummary[] {
  const summaries = new Map<string, OverviewBalanceSummary>()
  for (const group of groups) {
    const netBalance = group.financialSummary.netBalance
    if (netBalance === null || netBalance === 0) continue
    const { currency, currencyCode } = group.ledger
    const key = `${currencyCode ?? ''}:${currency}`
    const summary = summaries.get(key) ?? {
      currency,
      currencyCode,
      owedToYou: 0,
      owedToYouGroupCount: 0,
      youOwe: 0,
      youOweGroupCount: 0,
    }
    if (netBalance > 0) {
      summary.owedToYou += netBalance
      summary.owedToYouGroupCount += 1
    } else {
      summary.youOwe += Math.abs(netBalance)
      summary.youOweGroupCount += 1
    }
    summaries.set(key, summary)
  }
  return [...summaries.values()]
}

type PeopleInputGroup = {
  id: string
  displayName: string
  currency: { currency: string; currencyCode: string | null }
  currentParticipantId: string | null
  balances: Record<string, { total: number }>
  suggestedSettlements: Array<{ from: string; to: string; amount: number }>
}

type PeopleInputParticipant = {
  id: string
  name: string
  account: { id: string; name: string; image: string | null } | null
}

/**
 * Pure people-balances helper extracted from the existing overview route
 * (`summarizePeopleBalances`). Counterparty identity merges account-backed
 * participants across ledgers; name-only participants stay ledger-scoped.
 * Callers feed stored server balances + participant account identities from
 * ready snapshots (never filtered pages).
 */
export function summarizeOfflinePeopleBalances(
  groups: PeopleInputGroup[],
  participants: PeopleInputParticipant[],
): OverviewPeopleBalance[] {
  const byId = new Map(
    participants.map((participant) => [participant.id, participant]),
  )
  const people = new Map<
    string,
    OverviewPeopleBalance & {
      currenciesByKey: Map<string, OverviewPeopleBalance['currencies'][number]>
    }
  >()
  for (const group of groups) {
    const currentParticipantId = group.currentParticipantId
    if (currentParticipantId === null) continue
    for (const leg of group.suggestedSettlements) {
      if (leg.amount <= 0) continue
      const counterpartyId =
        leg.from === currentParticipantId
          ? leg.to
          : leg.to === currentParticipantId
            ? leg.from
            : null
      if (counterpartyId === null) continue
      const participant = byId.get(counterpartyId)
      if (!participant) continue
      const personKey = participant.account
        ? `account:${participant.account.id}`
        : `participant:${participant.id}`
      const currencyKey = `${group.currency.currencyCode ?? ''}:${group.currency.currency}`
      const signedAmount =
        leg.to === currentParticipantId ? leg.amount : -leg.amount
      let person = people.get(personKey)
      if (!person) {
        person = {
          key: personKey,
          name: participant.name,
          account: participant.account,
          currencies: [],
          currenciesByKey: new Map(),
        }
        people.set(personKey, person)
      }
      let currency = person.currenciesByKey.get(currencyKey)
      if (!currency) {
        currency = {
          currency: group.currency.currency,
          currencyCode: group.currency.currencyCode,
          netAmount: 0,
          groups: [],
        }
        person.currenciesByKey.set(currencyKey, currency)
        person.currencies.push(currency)
      }
      currency.netAmount += signedAmount
      const existing = currency.groups.find(
        (entry) => entry.groupId === group.id,
      )
      if (existing) {
        existing.amount += signedAmount
      } else {
        currency.groups.push({
          groupId: group.id,
          groupName: group.displayName,
          amount: signedAmount,
        })
      }
    }
  }
  return [...people.values()]
    .map(({ currenciesByKey: _ignored, ...person }) => ({
      ...person,
      currencies: person.currencies
        .filter((currency) => currency.netAmount !== 0)
        .map((currency) => ({
          ...currency,
          groups: currency.groups.filter((group) => group.amount !== 0),
        }))
        .filter((currency) => currency.groups.length > 0)
        .sort(
          (a, b) =>
            (a.currencyCode ?? a.currency).localeCompare(
              b.currencyCode ?? b.currency,
            ) || a.currency.localeCompare(b.currency),
        ),
    }))
    .filter((person) => person.currencies.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key))
}

export type OfflineOverviewGroup = OfflineCatalogEntry['overview'] & {
  availability: 'ready' | 'missing'
  capturedAt: Date | null
  dirtySince: Date | null
}

export type OfflineOverview = {
  groups: OfflineOverviewGroup[]
  balanceSummaries: OverviewBalanceSummary[]
  peopleBalances: OverviewPeopleBalance[]
  totalsAvailable: boolean
  incompleteGroupCount: number
  dirtyGroupCount: number
  oldestCapturedAt: Date | null
}

/**
 * Offline overview: catalog cards plus each ready group's stored overview.
 * Hidden/starred/archive come from the most recent catalog; financial summaries
 * come from snapshots (last-known, not a single transaction). Undownloaded
 * groups keep names/metadata but financialSummary is UNAVAILABLE. Account
 * totals render only when every catalog group is ready and none is dirty;
 * otherwise callers show `OFFLINE_COPY.totalsIncomplete`. Always expose the
 * oldest contributing capturedAt for complete aggregates.
 */
export function buildOfflineOverview(
  catalog: CatalogRecord | null,
  recordsByGroupId: Map<string, GroupRecord>,
): OfflineOverview {
  if (!catalog) {
    return {
      groups: [],
      balanceSummaries: [],
      peopleBalances: [],
      totalsAvailable: false,
      incompleteGroupCount: 0,
      dirtyGroupCount: 0,
      oldestCapturedAt: null,
    }
  }
  const groups: OfflineOverviewGroup[] = []
  let dirtyGroupCount = 0
  let oldestCapturedAt: Date | null = null
  const readyOverviews: Array<OfflineCatalogEntry['overview']> = []
  const peopleGroups: PeopleInputGroup[] = []
  const peopleParticipants = new Map<string, PeopleInputParticipant>()

  for (const entry of catalog.groups) {
    const groupId = entry.overview.id
    const record = recordsByGroupId.get(groupId)
    if (!record) {
      groups.push({
        ...entry.overview,
        financialSummary: {
          expenseCount: entry.overview.financialSummary.expenseCount,
          netBalance: null,
          state: 'UNAVAILABLE',
          latestExpenseCreatedAt:
            entry.overview.financialSummary.latestExpenseCreatedAt,
        },
        availability: 'missing',
        capturedAt: null,
        dirtySince: null,
      })
      continue
    }
    const dirty = record.dirtySince !== null
    if (dirty) dirtyGroupCount += 1
    if (!oldestCapturedAt || record.capturedAt < oldestCapturedAt) {
      oldestCapturedAt = record.capturedAt
    }
    groups.push({
      ...record.payload.overview,
      // Catalog preference wins (most recent); snapshot summary wins
      // (last-known per group, not a single account transaction).
      preference: entry.overview.preference,
      archived: entry.overview.archived,
      availability: 'ready',
      capturedAt: record.capturedAt,
      dirtySince: record.dirtySince,
    })
    readyOverviews.push(record.payload.overview)
    const balances = record.payload.balances
    const groupParticipants = snapshotGroupEntity(record).participants ?? []
    for (const participant of groupParticipants) {
      if (!peopleParticipants.has(participant.id)) {
        peopleParticipants.set(participant.id, {
          id: participant.id,
          name: participant.name,
          account: participant.account
            ? {
                id: participant.account.id,
                name: participant.account.name,
                image: participant.account.image ?? null,
              }
            : null,
        })
      }
    }
    for (const participant of balances.participants ?? []) {
      if (!peopleParticipants.has(participant.id)) {
        peopleParticipants.set(participant.id, {
          id: participant.id,
          name: participant.name,
          account: null,
        })
      }
    }
    // Current participant: resolve via the snapshot group member linked to
    // the catalog account? The snapshot overview does not carry the viewer
    // participant; use the group payload's members? Fall back to matching the
    // stored balances key that equals the overview net? Instead, derive from
    // the snapshot group participants by account identity when available.
    // When unknown, people balances skip the group (same as server null).
    const currentParticipantId = resolveCurrentParticipantId(record)
    peopleGroups.push({
      id: groupId,
      displayName: record.payload.overview.displayName,
      currency: {
        currency: record.payload.overview.ledger.currency,
        currencyCode: record.payload.overview.ledger.currencyCode,
      },
      currentParticipantId,
      balances: Object.fromEntries(
        Object.entries(balances.balances ?? {}).map(([id, value]) => [
          id,
          { total: value.total },
        ]),
      ),
      suggestedSettlements: balances.suggestedSettlements ?? [],
    })
  }

  const incompleteGroupCount = groups.filter(
    (group) => group.availability === 'missing',
  ).length
  const totalsAvailable =
    incompleteGroupCount === 0 && dirtyGroupCount === 0 && groups.length > 0
  return {
    groups,
    balanceSummaries: totalsAvailable
      ? summarizeOfflineBalances(readyOverviews)
      : [],
    peopleBalances: totalsAvailable
      ? summarizeOfflinePeopleBalances(peopleGroups, [
          ...peopleParticipants.values(),
        ])
      : [],
    totalsAvailable,
    incompleteGroupCount,
    dirtyGroupCount,
    oldestCapturedAt: totalsAvailable ? oldestCapturedAt : oldestCapturedAt,
  }
}

function snapshotGroupEntity(record: GroupRecord): {
  participants?: Array<{
    id: string
    name: string
    account?: { id: string; name: string; image?: string | null } | null
  }>
  members?: Array<{
    accountId?: string
    ledgerParticipant?: { id: string } | null
  }>
} {
  const output = record.payload.group as unknown as {
    group?: {
      participants?: Array<{
        id: string
        name: string
        account?: { id: string; name: string; image?: string | null } | null
      }>
      members?: Array<{
        accountId?: string
        ledgerParticipant?: { id: string } | null
      }>
    }
    participants?: Array<{
      id: string
      name: string
      account?: { id: string; name: string; image?: string | null } | null
    }>
    members?: Array<{
      accountId?: string
      ledgerParticipant?: { id: string } | null
    }>
  }
  return (output.group ?? output) as {
    participants?: Array<{
      id: string
      name: string
      account?: { id: string; name: string; image?: string | null } | null
    }>
    members?: Array<{
      accountId?: string
      ledgerParticipant?: { id: string } | null
    }>
  }
}

function resolveCurrentParticipantId(record: GroupRecord): string | null {
  const output = record.payload.group as unknown as {
    currentLedgerParticipantId?: string | null
  }
  // The snapshot stores the viewer participant directly; it is the same id
  // the server uses for involvement collapsing and people-balance legs.
  if (typeof output.currentLedgerParticipantId === 'string') {
    return output.currentLedgerParticipantId
  }
  if (output.currentLedgerParticipantId === null) return null
  const entity = snapshotGroupEntity(record)
  const namespaceAccount = parseAccountFromNamespace(record.namespace)
  if (namespaceAccount && Array.isArray(entity.members)) {
    for (const member of entity.members) {
      if (
        member.accountId === namespaceAccount &&
        member.ledgerParticipant?.id
      ) {
        return member.ledgerParticipant.id
      }
    }
  }
  if (namespaceAccount && Array.isArray(entity.participants)) {
    const match = entity.participants.find(
      (participant) => participant.account?.id === namespaceAccount,
    )
    if (match) return match.id
  }
  return null
}

function parseAccountFromNamespace(namespace: string): string | null {
  try {
    const parsed: unknown = JSON.parse(namespace)
    if (Array.isArray(parsed) && typeof parsed[1] === 'string') return parsed[1]
    return null
  } catch {
    return null
  }
}

// --- Global --------------------------------------------------------

export type GlobalQueryInput = GlobalExpenseFilter & {
  offset?: number
  limit?: number
}

export type GlobalQueryResult = {
  rows: Array<OfflineExpenseRecord & { group: OfflineCatalogEntry['global'] }>
  totalFiltered: number
  nextOffset: number | null
  hasMore: boolean
  incompleteGroupCount: number
  dirtyGroupCount: number
  /** Number of selected groups truncated at the recent-500 cap. */
  truncatedGroupCount: number
  /** Sum of server totalCounts for truncated groups; null when none truncated. */
  truncatedTotalCount: number | null
  /** Never authoritative when groups are missing/dirty. */
  totalsAuthoritative: false
  currencyError: 'currency-required' | null
}

function globalCurrencyKey(
  currency: string,
  currencyCode: string | null,
): string {
  return `${currencyCode ?? ''}:${currency}`
}

function personMatchesGlobal(
  list: OfflineListItem,
  detail: OfflineDetail | null,
  people: GlobalPersonRef[] | undefined,
  match: MatchMode | undefined,
  relation: 'paidBy' | 'paidFor',
): boolean {
  if (!people || people.length === 0) return true
  const mode = match ?? 'any'
  // Resolve each selected identity against list-level payer/beneficiary rows.
  // Account refs match the backing account id (preserving the server's
  // account-merge semantics); participant refs match ledger participant id.
  // Removed/unlinked participants keep their ledger id, so historical rows
  // still match after unlink.
  const testOne = (person: GlobalPersonRef): boolean => {
    const sides = relation === 'paidBy' ? list.paidByList : list.paidFor
    if (person.kind === 'account') {
      return sides.some(
        (side) => side.ledgerParticipant.account?.id === person.id,
      )
    }
    return sides.some((side) => side.ledgerParticipant.id === person.id)
  }
  if (mode === 'any') return people.some(testOne)
  if (mode === 'all') return people.every(testOne)
  // exact: every selected present and no unselected participant present.
  // Account-selected identities cover all ledger rows backed by that account.
  const covered = (side: {
    ledgerParticipant: { id: string; account?: { id: string } | null }
  }): boolean => {
    for (const person of people) {
      if (
        person.kind === 'account' &&
        side.ledgerParticipant.account?.id === person.id
      ) {
        return true
      }
      if (
        person.kind === 'participant' &&
        side.ledgerParticipant.id === person.id
      ) {
        return true
      }
    }
    return false
  }
  const sides = relation === 'paidBy' ? list.paidByList : list.paidFor
  void detail
  return people.every(testOne) && sides.every(covered)
}

/**
 * Global list: union all ready snapshots joined to stored global group
 * metadata. Default excludes hidden+archived like the server; explicit groupIds
 * take precedence; includeArchived defaults false. Global amount filters/sort
 * require exactly one base currency (existing validation). Missing/dirty groups
 * are counted above results, never as authoritative totals.
 */
export function queryGlobalExpensesOffline(
  catalog: CatalogRecord | null,
  recordsByGroupId: Map<string, GroupRecord>,
  input: GlobalQueryInput = {},
): GlobalQueryResult {
  const empty: GlobalQueryResult = {
    rows: [],
    totalFiltered: 0,
    nextOffset: null,
    hasMore: false,
    incompleteGroupCount: 0,
    dirtyGroupCount: 0,
    truncatedGroupCount: 0,
    truncatedTotalCount: null,
    totalsAuthoritative: false,
    currencyError: null,
  }
  if (!catalog) return empty
  if (
    (input.minAmount !== undefined ||
      input.maxAmount !== undefined ||
      input.sortBy === 'amount') &&
    input.currencies?.length !== 1
  ) {
    return { ...empty, currencyError: 'currency-required' }
  }
  const explicitIds =
    input.groupIds && input.groupIds.length > 0 ? new Set(input.groupIds) : null
  const includeArchived = input.includeArchived ?? false
  let incompleteGroupCount = 0
  let dirtyGroupCount = 0
  const selected: Array<{
    record: GroupRecord
    global: OfflineCatalogEntry['global']
  }> = []
  for (const entry of catalog.groups) {
    const groupId = entry.overview.id
    const record = recordsByGroupId.get(groupId)
    const global = entry.global
    const explicitlySelected = explicitIds?.has(groupId) ?? false
    if (!explicitIds) {
      if (global.hidden) {
        if (!record) incompleteGroupCount += 0
        continue
      }
      if (global.archived && !includeArchived) continue
    } else if (!explicitlySelected) {
      continue
    }
    // Currency scope applies before missing/dirty counting so excluded
    // currencies never inflate the counts.
    if (input.currencies && input.currencies.length > 0) {
      const key = globalCurrencyKey(global.currency, global.currencyCode)
      if (!input.currencies.includes(key)) continue
    }
    if (!record) {
      incompleteGroupCount += 1
      continue
    }
    if (record.dirtySince !== null) dirtyGroupCount += 1
    selected.push({ record, global })
  }

  const hasExplicitCategories =
    !!input.categories && input.categories.length > 0
  const expandedCategories = hasExplicitCategories
    ? expandCategorySelection(input.categories ?? [])
    : []
  const combined: Array<
    OfflineExpenseRecord & { group: OfflineCatalogEntry['global'] }
  > = []
  for (const { record, global } of selected) {
    for (const entry of record.payload.expenses) {
      const list = entry.list
      if (hasExplicitCategories) {
        const accepted =
          expandedCategories.length > 0
            ? expandedCategories.includes(list.categoryId)
            : (input.categories ?? []).includes(list.categoryId)
        if (!accepted) continue
      } else if (input.hideSettlements) {
        if (list.categoryId === SETTLEMENT_CATEGORY_ID) continue
      }
      if (!inDateBounds(list.expenseDate, input.dateFrom, input.dateTo))
        continue
      if (!inAmountBounds(list.amount, input.minAmount, input.maxAmount))
        continue
      if (
        !personMatchesGlobal(
          list,
          entry.detail,
          input.paidBy,
          input.paidByMatch,
          'paidBy',
        )
      ) {
        continue
      }
      if (
        !personMatchesGlobal(
          list,
          entry.detail,
          input.paidFor,
          input.paidForMatch,
          'paidFor',
        )
      ) {
        continue
      }
      if (!matchesGlobalSearch(list, entry.detail, input.search, input.locale))
        continue
      combined.push({
        ...entry,
        group: global,
      } as unknown as OfflineExpenseRecord & {
        group: OfflineCatalogEntry['global']
      })
    }
  }
  const sorted = sortGlobalRecords(
    combined as unknown as Array<OfflineExpenseRecord & { groupId: string }>,
    input.sortBy,
    input.sortDir,
  ) as unknown as Array<
    OfflineExpenseRecord & { group: OfflineCatalogEntry['global'] }
  >
  const page = paginateLocal(
    sorted,
    input.offset ?? 0,
    input.limit ?? OFFLINE_LOCAL_PAGE_SIZE,
  )
  // 500-cap disclosure: aggregate truncation across selected groups so the
  // global list never silently truncates. Mirrors the group list's
  // recent500WithCount/recent500Note contract.
  let truncatedGroupCount = 0
  let truncatedTotal = 0
  for (const { record } of selected) {
    if (record.payload.hasMore) {
      truncatedGroupCount += 1
      truncatedTotal += record.payload.totalCount ?? 0
    }
  }
  return {
    rows: page.rows,
    totalFiltered: sorted.length,
    nextOffset: page.nextOffset,
    hasMore: page.hasMore,
    incompleteGroupCount,
    dirtyGroupCount,
    truncatedGroupCount,
    truncatedTotalCount: truncatedGroupCount > 0 ? truncatedTotal : null,
    totalsAuthoritative: false,
    currencyError: null,
  }
}

/**
 * Chunked main-thread fallback for the global list: same pure semantics as
 * `queryGlobalExpensesOffline`, yielding every `chunkRows` expense rows so the
 * main thread stays responsive when the Worker is unavailable (CSP failure).
 */
export async function queryGlobalExpensesOfflineChunked(
  catalog: CatalogRecord | null,
  recordsByGroupId: Map<string, GroupRecord>,
  input: GlobalQueryInput = {},
  chunkRows: number = OFFLINE_FALLBACK_CHUNK_ROWS,
): Promise<GlobalQueryResult> {
  const empty: GlobalQueryResult = {
    rows: [],
    totalFiltered: 0,
    nextOffset: null,
    hasMore: false,
    incompleteGroupCount: 0,
    dirtyGroupCount: 0,
    truncatedGroupCount: 0,
    truncatedTotalCount: null,
    totalsAuthoritative: false,
    currencyError: null,
  }
  if (!catalog) return empty
  if (
    (input.minAmount !== undefined ||
      input.maxAmount !== undefined ||
      input.sortBy === 'amount') &&
    input.currencies?.length !== 1
  ) {
    return { ...empty, currencyError: 'currency-required' }
  }
  const explicitIds =
    input.groupIds && input.groupIds.length > 0 ? new Set(input.groupIds) : null
  const includeArchived = input.includeArchived ?? false
  let incompleteGroupCount = 0
  let dirtyGroupCount = 0
  const selected: Array<{
    record: GroupRecord
    global: OfflineCatalogEntry['global']
  }> = []
  for (const entry of catalog.groups) {
    const groupId = entry.overview.id
    const record = recordsByGroupId.get(groupId)
    const global = entry.global
    const explicitlySelected = explicitIds?.has(groupId) ?? false
    if (!explicitIds) {
      if (global.hidden) continue
      if (global.archived && !includeArchived) continue
    } else if (!explicitlySelected) {
      continue
    }
    if (input.currencies && input.currencies.length > 0) {
      const key = globalCurrencyKey(global.currency, global.currencyCode)
      if (!input.currencies.includes(key)) continue
    }
    if (!record) {
      incompleteGroupCount += 1
      continue
    }
    if (record.dirtySince !== null) dirtyGroupCount += 1
    selected.push({ record, global })
  }
  const hasExplicitCategories =
    !!input.categories && input.categories.length > 0
  const expandedCategories = hasExplicitCategories
    ? expandCategorySelection(input.categories ?? [])
    : []
  // Flatten candidates so filtering can yield every `chunkRows` rows like the
  // group fallback path.
  const candidates: Array<{
    entry: OfflineExpenseRecord
    global: OfflineCatalogEntry['global']
  }> = []
  for (const { record, global } of selected) {
    for (const entry of record.payload.expenses) {
      candidates.push({ entry, global })
    }
  }
  const combined: Array<
    OfflineExpenseRecord & { group: OfflineCatalogEntry['global'] }
  > = []
  for (let index = 0; index < candidates.length; index += 1) {
    const { entry, global } = candidates[index]!
    const list = entry.list
    let accepted = true
    if (hasExplicitCategories) {
      const ok =
        expandedCategories.length > 0
          ? expandedCategories.includes(list.categoryId)
          : (input.categories ?? []).includes(list.categoryId)
      if (!ok) accepted = false
    } else if (input.hideSettlements) {
      if (list.categoryId === SETTLEMENT_CATEGORY_ID) accepted = false
    }
    if (
      accepted &&
      !inDateBounds(list.expenseDate, input.dateFrom, input.dateTo)
    )
      accepted = false
    if (
      accepted &&
      !inAmountBounds(list.amount, input.minAmount, input.maxAmount)
    )
      accepted = false
    if (
      accepted &&
      !personMatchesGlobal(
        list,
        entry.detail,
        input.paidBy,
        input.paidByMatch,
        'paidBy',
      )
    ) {
      accepted = false
    }
    if (
      accepted &&
      !personMatchesGlobal(
        list,
        entry.detail,
        input.paidFor,
        input.paidForMatch,
        'paidFor',
      )
    ) {
      accepted = false
    }
    if (
      accepted &&
      !matchesGlobalSearch(list, entry.detail, input.search, input.locale)
    ) {
      accepted = false
    }
    if (accepted) {
      combined.push({
        ...entry,
        group: global,
      } as unknown as OfflineExpenseRecord & {
        group: OfflineCatalogEntry['global']
      })
    }
    if (index % chunkRows === 0 && index > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  }
  const sorted = sortGlobalRecords(
    combined as unknown as Array<OfflineExpenseRecord & { groupId: string }>,
    input.sortBy,
    input.sortDir,
  ) as unknown as Array<
    OfflineExpenseRecord & { group: OfflineCatalogEntry['global'] }
  >
  const chunkedPage = paginateLocal(
    sorted,
    input.offset ?? 0,
    input.limit ?? OFFLINE_LOCAL_PAGE_SIZE,
  )
  let truncatedGroupCount = 0
  let truncatedTotal = 0
  for (const { record } of selected) {
    if (record.payload.hasMore) {
      truncatedGroupCount += 1
      truncatedTotal += record.payload.totalCount ?? 0
    }
  }
  return {
    rows: chunkedPage.rows,
    totalFiltered: sorted.length,
    nextOffset: chunkedPage.nextOffset,
    hasMore: chunkedPage.hasMore,
    incompleteGroupCount,
    dirtyGroupCount,
    truncatedGroupCount,
    truncatedTotalCount: truncatedGroupCount > 0 ? truncatedTotal : null,
    totalsAuthoritative: false,
    currencyError: null,
  }
}

// --- Filter options ----------------------------------------------------------

export type OfflineFilterOptions = {
  groups: Array<
    OfflineCatalogEntry['global'] & { availability: 'ready' | 'missing' }
  >
  people: Array<{
    kind: 'account' | 'participant'
    id: string
    groupId?: string
    name: string
    groupName?: string
  }>
  currencies: Array<{
    key: string
    currency: string
    currencyCode: string | null
  }>
  incompleteGroupCount: number
}

/**
 * Filter options derive from complete downloaded records/group context with no
 * remote prerequisite before offline list rendering. Unavailable groups are
 * exposed as not downloaded (never selectable as empty). Removed/unlinked
 * participant identity is preserved from historical rendering.
 */
export function buildOfflineFilterOptions(
  catalog: CatalogRecord | null,
  recordsByGroupId: Map<string, GroupRecord>,
): OfflineFilterOptions {
  if (!catalog) {
    return { groups: [], people: [], currencies: [], incompleteGroupCount: 0 }
  }
  const groups = catalog.groups.map((entry) => ({
    ...entry.global,
    availability: (recordsByGroupId.has(entry.overview.id)
      ? 'ready'
      : 'missing') as 'ready' | 'missing',
  }))
  const incompleteGroupCount = groups.filter(
    (group) => group.availability === 'missing',
  ).length
  const peopleByKey = new Map<string, OfflineFilterOptions['people'][number]>()
  for (const entry of catalog.groups) {
    const record = recordsByGroupId.get(entry.overview.id)
    if (!record) continue
    // People from group participants (preserves removed/unlinked identity via
    // ledger ids) merged with account identities like the server.
    for (const participant of snapshotGroupEntity(record).participants ?? []) {
      const account = participant.account
      if (account) {
        const key = `account:${account.id}`
        if (!peopleByKey.has(key)) {
          peopleByKey.set(key, {
            kind: 'account',
            id: account.id,
            name: account.name ?? participant.name ?? '',
          })
        }
        continue
      }
      const key = `participant:${participant.id}`
      if (!peopleByKey.has(key)) {
        peopleByKey.set(key, {
          kind: 'participant',
          id: participant.id,
          groupId: entry.overview.id,
          name: participant.name ?? '',
          groupName: entry.overview.displayName,
        })
      }
    }
    // Participants that only appear in expense rows (e.g. removed members no
    // longer in the group roster) still resolve from list display names.
    for (const expense of record.payload.expenses) {
      for (const side of [
        ...expense.list.paidByList,
        ...expense.list.paidFor,
      ]) {
        const accountId = side.ledgerParticipant.account?.id
        if (accountId) {
          const key = `account:${accountId}`
          if (!peopleByKey.has(key)) {
            peopleByKey.set(key, {
              kind: 'account',
              id: accountId,
              name:
                side.ledgerParticipant.account?.name ??
                side.ledgerParticipant.name ??
                '',
            })
          }
          continue
        }
        const key = `participant:${side.ledgerParticipant.id}`
        if (!peopleByKey.has(key)) {
          peopleByKey.set(key, {
            kind: 'participant',
            id: side.ledgerParticipant.id,
            groupId: entry.overview.id,
            name: side.ledgerParticipant.name ?? '',
            groupName: entry.overview.displayName,
          })
        }
      }
    }
  }
  const people = [...peopleByKey.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  const currencyByKey = new Map<
    string,
    OfflineFilterOptions['currencies'][number]
  >()
  for (const entry of catalog.groups) {
    if (!recordsByGroupId.has(entry.overview.id)) continue
    const key = globalCurrencyKey(
      entry.global.currency,
      entry.global.currencyCode,
    )
    if (!currencyByKey.has(key)) {
      currencyByKey.set(key, {
        key,
        currency: entry.global.currency,
        currencyCode: entry.global.currencyCode,
      })
    }
  }
  return {
    groups,
    people,
    currencies: [...currencyByKey.values()],
    incompleteGroupCount,
  }
}

/**
 * Chunked main-thread fallback entry: same pure functions, yielding every 500
 * rows so scrolling/search stay responsive when the Worker is unavailable
 * (CSP/worker failure). Core reads still work.
 */
export async function chunkedFilterGroupRecords(
  records: OfflineExpenseRecord[],
  filter: GroupExpenseFilter,
  onYield?: () => void,
): Promise<OfflineExpenseRecord[]> {
  const out: OfflineExpenseRecord[] = []
  const hasExplicitCategories =
    !!filter.categories && filter.categories.length > 0
  const expanded = hasExplicitCategories
    ? expandCategorySelection(filter.categories ?? [])
    : []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!
    const single = applyGroupFilters([record], { ...filter })
    // Reuse the shared predicate per row but avoid re-expanding categories:
    void expanded
    if (single.length > 0) out.push(record)
    if (onYield && index % OFFLINE_FALLBACK_CHUNK_ROWS === 0 && index > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      onYield()
    }
  }
  return out
}
