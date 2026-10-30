import { Context, Effect, Layer, Option, Schema } from 'effect'

import { prisma } from '@spliit/db'
import {
  calculateShares,
  convertMinorUnitsByRate,
  isSettlementCategory,
  resolvePersonalInclusion,
} from '@spliit/domain'

import { randomId } from '../api/shared'
import { getCurrencyRate } from '../currency-rates'
import { ensurePersonalProfile } from './profile'

export class PersonalSyncError extends Schema.TaggedError<PersonalSyncError>()(
  'PersonalSyncError',
  {
    message: Schema.String,
    retryable: Schema.Boolean,
  },
) {}

function isRetryable(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause)
  return /timeout|connection|ECONN|ETIMEDOUT|EAI_AGAIN|deadlock|serialize/i.test(
    message,
  )
}

function syncError(cause: unknown): PersonalSyncError {
  return new PersonalSyncError({
    message: cause instanceof Error ? cause.message : String(cause),
    retryable: isRetryable(cause),
  })
}

type LoadedExpense = Awaited<ReturnType<typeof loadExpense>>

function loadExpense(expenseId: string) {
  return prisma.expense.findUnique({
    where: { id: expenseId },
    include: {
      ledger: {
        select: {
          currency: true,
          currencyCode: true,
          group: { select: { id: true, name: true } },
        },
      },
      paidFor: {
        include: {
          ledgerParticipant: {
            include: {
              groupMember: {
                include: { account: { select: { id: true } } },
              },
            },
          },
        },
      },
    },
  })
}

/** The holder's paid-for share in ledger minor units, keyed by account id. */
function holderShares(expense: LoadedExpense): Map<string, number> {
  if (!expense) return new Map()
  const shares = calculateShares({
    id: expense.id,
    amount: expense.amount,
    splitMode: expense.splitMode,
    categoryId: expense.categoryId,
    originalAmount: expense.originalAmount,
    originalCurrency: expense.originalCurrency,
    conversionRate: expense.conversionRate,
    conversionSource: expense.conversionSource,
    paidByList: [],
    paidFor: expense.paidFor.map((row) => ({
      shares: row.shares,
      participant: { id: row.ledgerParticipantId },
    })),
  })

  const byAccount = new Map<string, number>()
  for (const row of expense.paidFor) {
    const accountId = row.ledgerParticipant.groupMember?.account?.id
    if (!accountId) continue
    const share = shares[row.ledgerParticipantId] ?? 0
    byAccount.set(accountId, (byAccount.get(accountId) ?? 0) + share)
  }
  return byAccount
}

type SyncProfile = {
  currencyCode: string
  timeZone: string
  sharedEnabled: boolean
}

type SyncRule = { included: boolean; includeFrom: Date | null } | null

type SyncOverride = {
  state: 'INCLUDE' | 'EXCLUDE' | null
  categoryId: string | null
} | null

type SyncData = {
  kind: 'EXPENSE'
  amount: number
  currencyCode: string
  originalAmount: number
  originalCurrency: string
  conversionRate: number | null
  conversionSource: 'EXCHANGE' | null
  date: Date
  categoryId: string
  title: string
  source: 'GROUP'
  sourceExpenseId: string
  sourceGroupId: string
  sourceGroupName: string
  sourceDetachedAt: null
}

type SyncExisting = {
  id: string
  sourceDetachedAt: Date | null
  kind: string
  amount: number
  currencyCode: string
  originalAmount: number | null
  originalCurrency: string | null
  conversionRate: number | null
  conversionSource: string | null
  date: Date
  categoryId: string
  title: string | null
  sourceGroupId: string | null
  sourceGroupName: string | null
}

function isSyncDataEqual(existing: SyncExisting, data: SyncData): boolean {
  return (
    existing.kind === data.kind &&
    existing.amount === data.amount &&
    existing.currencyCode === data.currencyCode &&
    existing.originalAmount === data.originalAmount &&
    existing.originalCurrency === data.originalCurrency &&
    existing.conversionRate === data.conversionRate &&
    (existing.conversionSource ?? null) === data.conversionSource &&
    existing.date.getTime() === data.date.getTime() &&
    existing.categoryId === data.categoryId &&
    (existing.title ?? null) === (data.title ?? null) &&
    (existing.sourceGroupId ?? null) === data.sourceGroupId &&
    (existing.sourceGroupName ?? null) === data.sourceGroupName
  )
}

async function syncOne(
  expense: NonNullable<LoadedExpense>,
  accountId: string,
  share: number,
): Promise<void> {
  const group = expense.ledger.group
  if (!group) return

  // Only accounts that have opened Personal (and therefore have a profile)
  // can have rules or overrides. Never create a workspace as a side effect of
  // someone else's group expense.
  const profile = await prisma.personalProfile.findUnique({
    where: { accountId },
  })
  if (!profile) return

  const [rule, override] = await Promise.all([
    prisma.personalGroupRule.findUnique({
      where: { accountId_groupId: { accountId, groupId: group.id } },
      select: { included: true, includeFrom: true },
    }),
    prisma.personalExpenseOverride.findUnique({
      where: { accountId_expenseId: { accountId, expenseId: expense.id } },
      select: { state: true, categoryId: true },
    }),
  ])

  await applySyncOne(expense, accountId, profile, rule, override, share)
}

async function applySyncOne(
  expense: NonNullable<LoadedExpense>,
  accountId: string,
  profile: SyncProfile,
  rule: SyncRule,
  override: SyncOverride,
  share: number,
  preloadedExisting?: SyncExisting | null,
  rateCache?: Map<string, number | null>,
): Promise<void> {
  const group = expense.ledger.group
  if (!group) return

  const inclusion = resolvePersonalInclusion({
    masterEnabled: profile.sharedEnabled,
    rule,
    override,
    expense: {
      categoryId: expense.categoryId,
      date: expense.expenseDate,
    },
    profileTimeZone: profile.timeZone,
    share,
  })

  const where = {
    accountId,
    sourceExpenseId: expense.id,
  } as const

  if (!inclusion.included) {
    // Frozen snapshots are never removed by a later policy change.
    await prisma.personalTransaction.deleteMany({
      where: { ...where, sourceDetachedAt: null },
    })
    return
  }

  const existing: SyncExisting | null =
    preloadedExisting !== undefined
      ? preloadedExisting
      : await prisma.personalTransaction.findUnique({
          where: { accountId_sourceExpenseId: where },
          select: {
            id: true,
            sourceDetachedAt: true,
            kind: true,
            amount: true,
            currencyCode: true,
            originalAmount: true,
            originalCurrency: true,
            conversionRate: true,
            conversionSource: true,
            date: true,
            categoryId: true,
            title: true,
            sourceGroupId: true,
            sourceGroupName: true,
          },
        })
  // A detached row is a frozen snapshot after leaving the group or after a
  // group deletion. Never rewrite it from live group data.
  if (existing?.sourceDetachedAt) return

  const ledgerCode = expense.ledger.currencyCode
  let converted = share
  let rate: number | null = null
  const needsConversion =
    Boolean(ledgerCode) && ledgerCode !== profile.currencyCode

  if (needsConversion) {
    const rateKey = `${expense.expenseDate.toISOString().slice(0, 10)}|${ledgerCode}|${profile.currencyCode}`
    if (rateCache?.has(rateKey)) {
      const cached = rateCache.get(rateKey)
      if (cached == null) return
      rate = cached
    } else {
      const resolved = await Effect.runPromise(
        Effect.option(
          Effect.tryPromise({
            try: () =>
              getCurrencyRate({
                date: expense.expenseDate.toISOString().slice(0, 10),
                base: ledgerCode!,
                target: profile.currencyCode,
              }),
            catch: syncError,
          }),
        ),
      )
      // A missing provider quote is not a reason to invent a rate. The daily
      // reconcile pass retries once the provider recovers.
      if (Option.isNone(resolved)) {
        rateCache?.set(rateKey, null)
        return
      }
      rate = resolved.value.rate
      rateCache?.set(rateKey, rate)
    }
    converted = convertMinorUnitsByRate(
      share,
      rate,
      ledgerCode,
      profile.currencyCode,
    )
  }

  const data: SyncData = {
    kind: 'EXPENSE' as const,
    amount: converted,
    currencyCode: profile.currencyCode,
    originalAmount: share,
    originalCurrency: ledgerCode ?? expense.ledger.currency,
    conversionRate: rate,
    conversionSource: needsConversion ? ('EXCHANGE' as const) : null,
    date: inclusion.date,
    categoryId: inclusion.categoryId,
    title: expense.title,
    source: 'GROUP' as const,
    sourceExpenseId: expense.id,
    sourceGroupId: group.id,
    sourceGroupName: group.name,
    sourceDetachedAt: null,
  }

  if (existing) {
    // Compare-before-write: the daily reconcile must be a no-op when
    // nothing changed. Skipping the update keeps `version`/`updatedAt`
    // stable and avoids write amplification on large groups.
    if (isSyncDataEqual(existing, data)) return
    await prisma.personalTransaction.update({
      where: { id: existing.id },
      data: { ...data, version: { increment: 1 } },
    })
    return
  }

  await prisma.personalTransaction.create({
    data: {
      id: randomId(),
      accountId,
      ...data,
    },
  })
}

export async function getPersonalExpenseStatus(
  accountId: string,
  expenseId: string,
): Promise<{
  eligible: boolean
  included: boolean
  override: 'INCLUDE' | 'EXCLUDE' | null
}> {
  const expense = await loadExpense(expenseId)
  if (!expense?.ledger.group) {
    return { eligible: false, included: false, override: null }
  }
  const share = holderShares(expense).get(accountId) ?? 0
  const eligible = share !== 0 && !isSettlementCategory(expense.categoryId)
  const profile = await prisma.personalProfile.findUnique({
    where: { accountId },
  })
  if (!profile) {
    return { eligible, included: false, override: null }
  }
  const [rule, override] = await Promise.all([
    prisma.personalGroupRule.findUnique({
      where: {
        accountId_groupId: {
          accountId,
          groupId: expense.ledger.group.id,
        },
      },
      select: { included: true, includeFrom: true },
    }),
    prisma.personalExpenseOverride.findUnique({
      where: { accountId_expenseId: { accountId, expenseId } },
      select: { state: true, categoryId: true },
    }),
  ])
  const inclusion = resolvePersonalInclusion({
    masterEnabled: profile.sharedEnabled,
    rule,
    override,
    expense: {
      categoryId: expense.categoryId,
      date: expense.expenseDate,
    },
    profileTimeZone: profile.timeZone,
    share,
  })
  return {
    eligible,
    included: inclusion.included,
    override: override?.state ?? null,
  }
}

async function syncExpenseEffect(expenseId: string) {
  const expense = await loadExpense(expenseId)
  if (!expense?.ledger.group) return

  if (isSettlementCategory(expense.categoryId)) {
    await prisma.personalTransaction.deleteMany({
      where: { sourceExpenseId: expense.id, sourceDetachedAt: null },
    })
    return
  }

  const shares = holderShares(expense)
  await Promise.all(
    Array.from(shares.entries()).map(([accountId, share]) =>
      syncOne(expense, accountId, share),
    ),
  )
}

async function syncExpenseForAccountEffect(
  expenseId: string,
  accountId: string,
) {
  const expense = await loadExpense(expenseId)
  if (!expense?.ledger.group) return
  const share = holderShares(expense).get(accountId) ?? 0
  await syncOne(expense, accountId, share)
}

async function deleteExpenseEffect(expenseId: string) {
  // Detached rows are frozen snapshots: the holder left the group (or the
  // group was deleted), so another member deleting the source expense must not
  // erase their personal history.
  await prisma.personalTransaction.deleteMany({
    where: { sourceExpenseId: expenseId, sourceDetachedAt: null },
  })
}

async function freezeEffect(accountId: string, groupId: string) {
  await prisma.personalTransaction.updateMany({
    where: {
      accountId,
      sourceGroupId: groupId,
      sourceDetachedAt: null,
    },
    data: { sourceDetachedAt: new Date() },
  })
}

async function freezeGroupEffect(groupId: string) {
  await prisma.personalTransaction.updateMany({
    where: { sourceGroupId: groupId, sourceDetachedAt: null },
    data: { sourceDetachedAt: new Date() },
  })
}

async function renameGroupEffect(groupId: string, name: string) {
  await prisma.personalTransaction.updateMany({
    where: { sourceGroupId: groupId },
    data: { sourceGroupName: name },
  })
}

const GROUP_SYNC_PAGE_SIZE = 100

async function syncGroupEffect(
  accountId: string,
  groupId: string,
): Promise<number> {
  const member = await prisma.groupMember.findFirst({
    where: { accountId, groupId, status: 'ACTIVE' },
    select: { id: true },
  })
  if (!member) {
    // Leaving a group freezes history. Never resurrect it through a stale
    // rule during reconcile.
    await freezeEffect(accountId, groupId)
    return 0
  }
  const profile = await ensurePersonalProfile(accountId)
  const rule = await prisma.personalGroupRule.findUnique({
    where: { accountId_groupId: { accountId, groupId } },
    select: { included: true, includeFrom: true },
  })

  if (!rule?.included) {
    // INCLUDE pins survive a rule-off, but they still obey the
    // single-expense semantics: a model-included pin is refreshed, a
    // model-excluded pin (master off, zero share, settlement) is deleted.
    const pinned = await prisma.personalExpenseOverride.findMany({
      where: { accountId, state: 'INCLUDE' },
      select: {
        expenseId: true,
        expense: {
          select: { ledger: { select: { group: { select: { id: true } } } } },
        },
      },
    })
    const pinnedIds = pinned.map((row) => row.expenseId)
    await prisma.personalTransaction.deleteMany({
      where: {
        accountId,
        sourceGroupId: groupId,
        sourceDetachedAt: null,
        ...(pinnedIds.length ? { sourceExpenseId: { notIn: pinnedIds } } : {}),
      },
    })
    for (const row of pinned) {
      if (row.expense?.ledger?.group?.id !== groupId) continue
      // Same per-expense path as the live hook, so pinned rows converge
      // instead of going stale. Detached snapshots stay frozen.
      await syncExpenseForAccountEffect(row.expenseId, accountId)
    }
    return 0
  }

  // Rejoining (or re-enabling) thaws a frozen slice before the live sync.
  await prisma.personalTransaction.updateMany({
    where: {
      accountId,
      sourceGroupId: groupId,
      sourceDetachedAt: { not: null },
    },
    data: { sourceDetachedAt: null },
  })

  const expenseWhere = {
    ledger: { group: { id: groupId } },
    categoryId: { not: 'settlement' },
    // The share policy compares calendar dates in the profile zone. Widen
    // the SQL prefilter by a day so negative UTC offsets never drop the
    // boundary date; resolvePersonalInclusion owns the exact comparison.
    ...(rule.includeFrom
      ? {
          expenseDate: {
            gte: new Date(rule.includeFrom.getTime() - 86_400_000),
          },
        }
      : {}),
    paidFor: {
      some: { ledgerParticipant: { groupMember: { accountId } } },
    },
  }

  // Bounded group loop: profile/rule loaded once above; expenses arrive with
  // their paidFor/account graph in pages, overrides + existing rows are
  // fetched once per page. Per-expense inclusion/conversion/upsert semantics
  // match the single-expense hook via `applySyncOne`.
  const rateCache = new Map<string, number | null>()
  let total = 0
  let cursor: string | undefined
  for (;;) {
    const expenses = await prisma.expense.findMany({
      where: expenseWhere,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: GROUP_SYNC_PAGE_SIZE,
      orderBy: { id: 'asc' },
      include: {
        ledger: {
          select: {
            currency: true,
            currencyCode: true,
            group: { select: { id: true, name: true } },
          },
        },
        paidFor: {
          include: {
            ledgerParticipant: {
              include: {
                groupMember: {
                  include: { account: { select: { id: true } } },
                },
              },
            },
          },
        },
      },
    })
    if (expenses.length === 0) break
    total += expenses.length

    const expenseIds = expenses.map((expense) => expense.id)
    const [overrides, existingRows] = await Promise.all([
      prisma.personalExpenseOverride.findMany({
        where: { accountId, expenseId: { in: expenseIds } },
        select: { expenseId: true, state: true, categoryId: true },
      }),
      prisma.personalTransaction.findMany({
        where: { accountId, sourceExpenseId: { in: expenseIds } },
        select: {
          id: true,
          sourceDetachedAt: true,
          kind: true,
          amount: true,
          currencyCode: true,
          originalAmount: true,
          originalCurrency: true,
          conversionRate: true,
          conversionSource: true,
          date: true,
          categoryId: true,
          title: true,
          sourceGroupId: true,
          sourceGroupName: true,
          sourceExpenseId: true,
        },
      }),
    ])
    const overrideByExpenseId = new Map(
      overrides.map((row) => [row.expenseId, row]),
    )
    const existingByExpenseId = new Map(
      existingRows.map((row) => [row.sourceExpenseId as string, row]),
    )

    const toDelete: string[] = []
    for (const expense of expenses) {
      const typed = expense as NonNullable<LoadedExpense>
      const share = holderShares(typed).get(accountId) ?? 0
      const override = overrideByExpenseId.get(expense.id) ?? null
      const inclusion = resolvePersonalInclusion({
        masterEnabled: profile.sharedEnabled,
        rule,
        override,
        expense: {
          categoryId: expense.categoryId,
          date: expense.expenseDate,
        },
        profileTimeZone: profile.timeZone,
        share,
      })
      if (!inclusion.included) {
        const existing = existingByExpenseId.get(expense.id)
        if (existing && !existing.sourceDetachedAt) {
          toDelete.push(existing.id)
        }
        continue
      }
      const existing = existingByExpenseId.get(expense.id) ?? null
      // Frozen rows are never rewritten; the thaw above already cleared
      // rejoin slices, so a detached row here means the holder left.
      if (existing?.sourceDetachedAt) continue
      await applySyncOne(
        typed,
        accountId,
        profile,
        rule,
        override,
        share,
        existing,
        rateCache,
      )
    }
    if (toDelete.length > 0) {
      await prisma.personalTransaction.deleteMany({
        where: { id: { in: toDelete } },
      })
    }
    if (expenses.length < GROUP_SYNC_PAGE_SIZE) break
    cursor = expenses[expenses.length - 1]?.id
    if (!cursor) break
  }
  return total
}

async function syncGroupMembersEffect(groupId: string): Promise<void> {
  const rules = await prisma.personalGroupRule.findMany({
    where: { groupId, included: true },
    select: { accountId: true },
  })
  for (const rule of rules) {
    await syncGroupEffect(rule.accountId, groupId)
  }
}

async function reconcileEffect(accountId: string): Promise<number> {
  const rules = await prisma.personalGroupRule.findMany({
    where: { accountId, included: true },
    select: { groupId: true },
  })
  let synced = 0
  for (const rule of rules) {
    synced += await syncGroupEffect(accountId, rule.groupId)
  }

  // Orphan repair: linked rows whose source expense disappeared while a hook
  // was missed. Detached snapshots are intentionally kept.
  const linked = await prisma.personalTransaction.findMany({
    where: {
      accountId,
      source: 'GROUP',
      sourceExpenseId: { not: null },
      sourceDetachedAt: null,
    },
    select: { id: true, sourceExpenseId: true },
  })
  if (linked.length > 0) {
    const existing = await prisma.expense.findMany({
      where: {
        id: {
          in: linked
            .map((row) => row.sourceExpenseId)
            .filter((id): id is string => Boolean(id)),
        },
      },
      select: { id: true },
    })
    const existingIds = new Set(existing.map((row) => row.id))
    const orphans = linked.filter(
      (row) => row.sourceExpenseId && !existingIds.has(row.sourceExpenseId),
    )
    if (orphans.length > 0) {
      await prisma.personalTransaction.deleteMany({
        where: { id: { in: orphans.map((row) => row.id) } },
      })
    }
  }
  return synced
}

export class PersonalInclusionService extends Context.Service<
  PersonalInclusionService,
  {
    readonly syncExpense: (
      expenseId: string,
    ) => Effect.Effect<void, PersonalSyncError>
    readonly syncExpenseForAccount: (
      expenseId: string,
      accountId: string,
    ) => Effect.Effect<void, PersonalSyncError>
    readonly deleteExpense: (
      expenseId: string,
    ) => Effect.Effect<void, PersonalSyncError>
    readonly syncGroup: (
      accountId: string,
      groupId: string,
    ) => Effect.Effect<number, PersonalSyncError>
    readonly reconcile: (
      accountId: string,
    ) => Effect.Effect<number, PersonalSyncError>
    readonly syncGroupMembers: (
      groupId: string,
    ) => Effect.Effect<void, PersonalSyncError>
    readonly freeze: (
      accountId: string,
      groupId: string,
    ) => Effect.Effect<void, PersonalSyncError>
    readonly freezeGroup: (
      groupId: string,
    ) => Effect.Effect<void, PersonalSyncError>
    readonly renameGroup: (
      groupId: string,
      name: string,
    ) => Effect.Effect<void, PersonalSyncError>
  }
>()('@spliit/api/personal/PersonalInclusionService') {
  static readonly Live = Layer.succeed(
    PersonalInclusionService,
    PersonalInclusionService.of({
      syncExpense: (expenseId) =>
        Effect.tryPromise({
          try: () => syncExpenseEffect(expenseId),
          catch: syncError,
        }),
      syncExpenseForAccount: (expenseId, accountId) =>
        Effect.tryPromise({
          try: () => syncExpenseForAccountEffect(expenseId, accountId),
          catch: syncError,
        }),
      deleteExpense: (expenseId) =>
        Effect.tryPromise({
          try: () => deleteExpenseEffect(expenseId),
          catch: syncError,
        }),
      syncGroup: (accountId, groupId) =>
        Effect.tryPromise({
          try: () => syncGroupEffect(accountId, groupId),
          catch: syncError,
        }),
      reconcile: (accountId) =>
        Effect.tryPromise({
          try: () => reconcileEffect(accountId),
          catch: syncError,
        }),
      syncGroupMembers: (groupId) =>
        Effect.tryPromise({
          try: () => syncGroupMembersEffect(groupId),
          catch: syncError,
        }),
      freeze: (accountId, groupId) =>
        Effect.tryPromise({
          try: () => freezeEffect(accountId, groupId),
          catch: syncError,
        }),
      freezeGroup: (groupId) =>
        Effect.tryPromise({
          try: () => freezeGroupEffect(groupId),
          catch: syncError,
        }),
      renameGroup: (groupId, name) =>
        Effect.tryPromise({
          try: () => renameGroupEffect(groupId, name),
          catch: syncError,
        }),
    }),
  )
}

/**
 * Best-effort post-commit hook for group expense writes. Personal projection
 * must never fail a group mutation; the reconcile pass repairs missed work.
 */
export async function runPersonalSync(
  effect: Effect.Effect<void, PersonalSyncError, PersonalInclusionService>,
): Promise<void> {
  await Effect.runPromise(
    effect.pipe(
      Effect.provide(PersonalInclusionService.Live),
      Effect.catch((error) =>
        Effect.logWarning(`Personal sync skipped: ${error.message}`),
      ),
    ),
  )
}

export async function runPersonalSyncResult<A>(
  effect: Effect.Effect<A, PersonalSyncError, PersonalInclusionService>,
): Promise<A> {
  return Effect.runPromise(
    effect.pipe(Effect.provide(PersonalInclusionService.Live)),
  )
}
