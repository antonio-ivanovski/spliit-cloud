import { Effect, Predicate, Schema } from 'effect'

import { DEFAULT_CATEGORIES, SETTLEMENT_CATEGORY_ID } from '../categories'
import { sharesAsFixedUnits } from '../shares'
import { legacyRuleToRecurrence } from './recurrence'
import {
  recoverSpliitOriginalAmount,
  shouldRecoverSpliitOriginal,
} from './spliit-original-amount'
import { ImportError } from './types'
import type { NormalizedSource, NormalizedSourceExpense } from './types'

const NonEmptyString = Schema.String.pipe(Schema.check(Schema.isMinLength(1)))

const IsoDateTimeString = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/,
    ),
  ),
)

const UrlString = Schema.String.pipe(
  Schema.refine((value: string): value is string => URL.canParse(value), {
    message: 'expected a URL',
  }),
)

const NonNegativeInt = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
)

const PositiveInt = Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)))

const CoercedInt = Schema.Union([
  Schema.Int,
  Schema.NumberFromString.pipe(
    Schema.refine((value: number): value is number => Number.isInteger(value), {
      message: 'expected an integer',
    }),
  ),
])

const CoercedNullableInt = Schema.optional(Schema.NullOr(CoercedInt))

const CoercedNullableNumber = Schema.optional(
  Schema.NullOr(Schema.Union([Schema.Number, Schema.NumberFromString])),
)

/**
 * This parser accepts the original unversioned export and the upstream v3
 * extension. Keep current Spliit Cloud-only recurrence state out of this wire
 * schema; normalize only fields emitted by spliit.app.
 */
export const spliitExportSchema = Schema.Struct({
  exportVersion: Schema.optional(Schema.Literal(3)),
  id: NonEmptyString,
  name: NonEmptyString,
  information: Schema.optional(Schema.NullOr(Schema.String)),
  currency: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(5)),
  ),
  // Legacy spliit.app exports use an empty string for custom currencies.
  // Normalize that representation to null at the parser boundary below.
  currencyCode: Schema.optional(
    Schema.NullOr(
      Schema.Union([
        Schema.String.pipe(
          Schema.check(Schema.isMinLength(3)),
          Schema.check(Schema.isMaxLength(4)),
        ),
        Schema.Literal(''),
      ]),
    ),
  ),
  participants: Schema.Array(
    Schema.Struct({
      id: NonEmptyString,
      name: NonEmptyString,
    }),
  ).pipe(Schema.check(Schema.isMinLength(1))),
  expenses: Schema.Array(
    Schema.Struct({
      id: Schema.optional(NonEmptyString),
      createdAt: Schema.optional(IsoDateTimeString),
      title: NonEmptyString,
      amount: NonNegativeInt,
      paidById: NonEmptyString,
      paidFor: Schema.Array(
        Schema.Struct({
          participantId: NonEmptyString,
          shares: NonNegativeInt,
        }),
      ).pipe(Schema.check(Schema.isMinLength(1))),
      isReimbursement: Schema.optional(Schema.Boolean).pipe(
        Schema.withDecodingDefault(Effect.succeed(false)),
      ),
      splitMode: Schema.optional(
        Schema.Literals(['EVENLY', 'BY_SHARES', 'BY_PERCENTAGE', 'BY_AMOUNT']),
      ).pipe(Schema.withDecodingDefault(Effect.succeed('EVENLY' as const))),
      recurrenceRule: Schema.optional(
        Schema.Literals(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY']),
      ).pipe(Schema.withDecodingDefault(Effect.succeed('NONE' as const))),
      expenseDate: Schema.String.pipe(
        Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}/)),
      ),
      category: Schema.optional(
        Schema.NullOr(
          Schema.Struct({
            grouping: Schema.String,
            name: Schema.String,
          }),
        ),
      ),
      originalAmount: CoercedNullableInt,
      originalCurrency: Schema.optional(
        Schema.NullOr(
          Schema.String.pipe(
            Schema.check(Schema.isMinLength(3)),
            Schema.check(Schema.isMaxLength(4)),
          ),
        ),
      ),
      conversionRate: CoercedNullableNumber,
      notes: Schema.optional(Schema.NullOr(Schema.String)),
      documents: Schema.optional(
        Schema.Array(
          Schema.Struct({
            id: NonEmptyString,
            url: UrlString,
            width: PositiveInt,
            height: PositiveInt,
          }),
        ),
      ),
    }),
  ),
  activities: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: NonEmptyString,
        time: IsoDateTimeString,
        activityType: Schema.Literals([
          'UPDATE_GROUP',
          'CREATE_EXPENSE',
          'UPDATE_EXPENSE',
          'DELETE_EXPENSE',
        ]),
        participantId: Schema.NullOr(NonEmptyString),
        expenseId: Schema.NullOr(NonEmptyString),
        data: Schema.NullOr(Schema.String),
      }),
    ),
  ),
})

export type SpliitExport = Schema.Schema.Type<typeof spliitExportSchema>

function resolveCategoryId(
  category: SpliitExport['expenses'][number]['category'],
): string {
  if (!Predicate.isObject(category)) return 'general'
  const match = DEFAULT_CATEGORIES.find(
    (c) =>
      c.grouping.toLowerCase() === category.grouping.toLowerCase() &&
      c.name.toLowerCase() === category.name.toLowerCase(),
  )
  if (match) return match.id
  const partial = DEFAULT_CATEGORIES.find(
    (c) => c.name.toLowerCase() === category.name.toLowerCase(),
  )
  return partial?.id ?? 'general'
}

const normalizeSpliitExport = Effect.fnUntraced(function* (
  parsed: SpliitExport,
): Effect.fn.Return<NormalizedSource, ImportError> {
  const upstreamIdToSourceId = new Map<string, string>()
  const seenUpstreamIds = new Set<string>()
  const participants: NormalizedSource['participants'] = []
  for (let index = 0; index < parsed.participants.length; index += 1) {
    const p = parsed.participants[index]!
    if (seenUpstreamIds.has(p.id)) {
      return yield* new ImportError({
        message: `The export contains duplicate participant ids (id "${p.id}").`,
        code: 'SPLIIT_DUPLICATE_PARTICIPANT_IDS',
        params: { participantId: p.id },
      })
    }
    seenUpstreamIds.add(p.id)
    const sourceId = `spliit-participant-${index}`
    upstreamIdToSourceId.set(p.id, sourceId)
    participants.push({ sourceId, sourceName: p.name })
  }

  const mustGetSourceId = (
    upstreamId: string,
    title: string,
  ): Effect.Effect<string, ImportError> => {
    const sourceId = upstreamIdToSourceId.get(upstreamId)
    if (!sourceId) {
      return new ImportError({
        message: `Expense "${title}" references an unknown participant.`,
        code: 'SPLIIT_UNKNOWN_PARTICIPANT',
        params: { title },
      })
    }
    return Effect.succeed(sourceId)
  }

  const seenExpenseIds = new Set<string>()
  const seenDocumentIds = new Set<string>()
  const expenses: NormalizedSourceExpense[] = []
  for (const e of parsed.expenses) {
    if (e.id && seenExpenseIds.has(e.id)) {
      return yield* new ImportError({
        message: `The export contains duplicate expense ids (id "${e.id}").`,
        code: 'SPLIIT_DUPLICATE_EXPENSE_IDS',
        params: { expenseId: e.id },
      })
    }
    if (e.id) seenExpenseIds.add(e.id)
    for (const document of e.documents ?? []) {
      if (seenDocumentIds.has(document.id)) {
        return yield* new ImportError({
          message: `The export contains duplicate document ids (id "${document.id}").`,
          code: 'SPLIIT_DUPLICATE_DOCUMENT_IDS',
          params: { documentId: document.id },
        })
      }
      seenDocumentIds.add(document.id)
    }
    const paidBySourceId = yield* mustGetSourceId(e.paidById, e.title)
    const paidFor: NormalizedSourceExpense['paidFor'] = []
    const seenInRow = new Set<string>()
    for (const row of e.paidFor) {
      const sourceId = yield* mustGetSourceId(row.participantId, e.title)
      if (seenInRow.has(sourceId)) {
        return yield* new ImportError({
          message: `Expense "${e.title}" has duplicate paid-for participants.`,
          code: 'SPLIIT_DUPLICATE_PAID_FOR',
          params: { title: e.title },
        })
      }
      seenInRow.add(sourceId)
      if (!Number.isInteger(row.shares) || row.shares <= 0) {
        return yield* new ImportError({
          message: `Expense "${e.title}" has a non-positive share.`,
          code: 'SPLIIT_NON_POSITIVE_SHARE',
          params: { title: e.title },
        })
      }
      // Legacy whole-share weights from spliit.app's BY_SHARES export.
      // Spliit Cloud stores BY_SHARES as fixed units (`100 = 1 share`),
      // so multiply legacy whole numbers once to land in the new
      // internal representation. EVENLY/PERCENTAGE/AMOUNT modes pass
      // through unchanged because the same column carries the literal
      // mode-specific unit (basis points / minor units / even marker).
      const normalizedShares =
        (e.splitMode ?? 'EVENLY') === 'BY_SHARES'
          ? sharesAsFixedUnits(row.shares)
          : row.shares
      paidFor.push({ sourceId, shares: normalizedShares })
    }
    if (!Number.isInteger(e.amount) || e.amount < 0) {
      return yield* new ImportError({
        message: `Expense "${e.title}" has an invalid amount.`,
        code: 'SPLIIT_INVALID_AMOUNT',
        params: { title: e.title },
      })
    }
    // Export `amount` is always the source-group ledger total (reliable).
    // Do not trust export `originalAmount` — recover from ledger ÷ rate
    // (upstream #513: originalAmount often drops cents). Once per parse only.
    const shouldRecover = shouldRecoverSpliitOriginal({
      originalCurrency: e.originalCurrency,
      conversionRate: e.conversionRate,
    })
    const expenseAmount = shouldRecover
      ? recoverSpliitOriginalAmount(e.amount, e.conversionRate!)
      : e.amount
    const expenseCurrency = shouldRecover
      ? e.originalCurrency!
      : parsed.currencyCode || null
    const recurrence = legacyRuleToRecurrence(e.recurrenceRule ?? 'NONE')

    expenses.push({
      sourceId: e.id ?? null,
      sourceCreatedAt: e.createdAt ?? null,
      title: e.title,
      expenseDate: e.expenseDate.slice(0, 10),
      category:
        (e.isReimbursement ?? false)
          ? SETTLEMENT_CATEGORY_ID
          : resolveCategoryId(e.category ?? null),
      amountCurrency: expenseCurrency,
      amount: expenseAmount,
      originalAmount: shouldRecover ? expenseAmount : null,
      originalCurrency: shouldRecover ? e.originalCurrency! : null,
      conversionRate: shouldRecover ? e.conversionRate! : null,
      paidBySourceId,
      paidBy: [{ sourceId: paidBySourceId, shares: expenseAmount }],
      paidFor,
      splitMode: e.splitMode ?? 'EVENLY',
      recurrenceRule: e.recurrenceRule ?? 'NONE',
      recurrence,
      notes: e.notes ?? null,
      ...(parsed.exportVersion === 3
        ? {
            sourceDocuments: (e.documents ?? []).map((document) => ({
              sourceId: document.id,
              sourceUrl: document.url,
              width: document.width,
              height: document.height,
            })),
          }
        : {}),
    })
  }

  const activities = parsed.activities?.map((activity) => ({
    time: activity.time,
    activityType: activity.activityType,
    participantSourceId: activity.participantId
      ? (upstreamIdToSourceId.get(activity.participantId) ?? null)
      : null,
    expenseSourceId: activity.expenseId,
    data: activity.data,
  }))

  return {
    provider: 'SPLIIT',
    exportVersion: parsed.exportVersion ?? null,
    sourceGroupId: parsed.id,
    sourceUrl: `https://spliit.app/groups/${parsed.id}`,
    name: parsed.name,
    information: parsed.information ?? null,
    currency: parsed.currency,
    currencyCode: parsed.currencyCode || null,
    participants,
    expenses,
    documentSource: parsed.exportVersion === 3 ? 'EMBEDDED' : 'DISCOVERY',
    ...(activities !== undefined ? { activities } : {}),
  }
})

export const parseSpliitExport = Effect.fnUntraced(function* (
  input: unknown,
): Effect.fn.Return<NormalizedSource, ImportError> {
  const parsed = yield* Schema.decodeUnknownEffect(spliitExportSchema)(
    input,
  ).pipe(
    Effect.catch(() =>
      Effect.fail(
        new ImportError({
          message: 'This file is not a supported spliit.app JSON export.',
          code: 'SPLIIT_UNSUPPORTED_SHAPE',
          params: {},
        }),
      ),
    ),
  )
  return yield* normalizeSpliitExport(parsed)
})

export function buildSpliitGroupFetchUrl(
  groupId: string,
  base: string = 'https://spliit.app',
): string {
  const trimmed = groupId.replace(/^\/+|\/+$/g, '')
  return `${base.replace(/\/+$/, '')}/groups/${trimmed}/expenses/export/json`
}

export function extractSpliitGroupIdFromUrl(input: string): string | null {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  if (!/^(www\.)?spliit\.app$/i.test(url.hostname)) return null
  const match = url.pathname.match(/^\/groups\/([^/?#]+)/)
  if (!match) return null
  const id = match[1]!.replace(/^\/+|\/+$/g, '')
  return id.length > 0 ? id : null
}
