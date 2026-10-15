/**
 * Tricount share-link API normalizer — Effect-native reference implementation.
 *
 * Converts the (unofficial) `api.tricount.bunq.com` registry payload into a
 * {@link NormalizedSource}. The wire shape is documented by the public sample
 * `https://tricount.com/tMjbqgwJxaikhUbkNz` (`mlaily/TricountApi`
 * `samples.json`):
 *
 * - `Response[0].Registry`: `title`, `description`, `currency`,
 *   `public_identifier_token`, `memberships[]` (`RegistryMembershipNonUser` →
 *   `alias.display_name`), `all_registry_entry[]`.
 * - Each `RegistryEntry`: signed `amount{currency,value}` (expenses negative,
 *   incomes positive), `amount_local` + `exchange_rate` for foreign-currency
 *   rows, `description`, `date`, `category`, `category_custom`,
 *   `type_transaction` (`NORMAL`|`INCOME`|`BALANCE`), `membership_owned`
 *   (payer), `allocations[]` (`amount`, `amount_local`, `membership`, `type`
 *   `AMOUNT`|`RATIO`, `share_ratio`).
 *
 * Amount semantics mirror the CSV parser: normalize to a positive cost in the
 * entry currency, keep `conversionRate` from the historical `exchange_rate`,
 * and let the wizard convert at confirm time. `BALANCE` rows become
 * settlements; `INCOME` rows keep their owed side.
 *
 * The HTTP fetch itself lives API-side (`tricountPreview` procedure, mirroring
 * `importPreview`); this module is pure normalization so it stays worker-safe
 * and unit-testable against recorded fixtures.
 */

import { Effect, Predicate, Schema } from 'effect'

import { getCurrency } from '../currency'
import type { Currency } from '../currency'
import { distributeRemainder } from '../remainder-distribution'
import {
  calculateExactShares,
  serializePaidBy,
  serializePaidFor,
} from '../totals'
import { amountAsMinorUnitsByCode } from '../utils'
import { guessSplitMode } from './split-guess'
import { tricountCategoryToId } from './tricount-categories'
import { ImportError } from './types'
import type { NormalizedSource } from './types'

const FALLBACK_CURRENCY: Currency = {
  code: '',
  symbol: '',
  rounding: 0,
  decimal_digits: 2,
}

const MoneySchema = Schema.Struct({
  currency: Schema.String,
  value: Schema.String,
})

const AliasSchema = Schema.Struct({
  display_name: Schema.String,
})

const MembershipSchema = Schema.Struct({
  RegistryMembershipNonUser: Schema.Struct({
    alias: AliasSchema,
  }),
})

const AllocationSchema = Schema.Struct({
  amount: MoneySchema,
  amount_local: Schema.optional(MoneySchema),
  membership: MembershipSchema,
  type: Schema.optional(Schema.String),
  share_ratio: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
})

const RegistryEntrySchema = Schema.Struct({
  id: Schema.Union([Schema.Number, Schema.String]),
  uuid: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  amount: MoneySchema,
  amount_local: Schema.optional(MoneySchema),
  exchange_rate: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
  description: Schema.optional(Schema.String),
  type_transaction: Schema.optional(Schema.String),
  membership_owned: MembershipSchema,
  allocations: Schema.Array(AllocationSchema),
  category: Schema.optional(Schema.String),
  category_custom: Schema.optional(Schema.Unknown),
  date: Schema.String,
})

const RegistrySchema = Schema.Struct({
  title: Schema.String,
  description: Schema.optional(Schema.Unknown),
  currency: Schema.String,
  public_identifier_token: Schema.optional(Schema.String),
  memberships: Schema.Array(MembershipSchema),
  all_registry_entry: Schema.Array(
    Schema.Struct({ RegistryEntry: RegistryEntrySchema }),
  ),
})

const TricountApiResponseSchema = Schema.Struct({
  Response: Schema.Array(Schema.Struct({ Registry: RegistrySchema })),
})

type Registry = typeof RegistrySchema.Type
type RegistryEntry = typeof RegistryEntrySchema.Type

function displayName(membership: {
  RegistryMembershipNonUser: { alias: { display_name: string } }
}): string {
  return membership.RegistryMembershipNonUser.alias.display_name
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isNaN(n) ? null : n
}

function parseDatePrefix(value: string): string | null {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1]! : null
}

function optionalText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

const normalizeRegistry = Effect.fnUntraced(function* (
  registry: Registry,
  sourceUrl: string | null,
): Effect.fn.Return<NormalizedSource, ImportError> {
  const participants: NormalizedSource['participants'] = []
  const nameToSourceId = new Map<string, string>()
  const registerMember = (name: string): string => {
    const existing = nameToSourceId.get(name.toLowerCase())
    if (existing) return existing
    const sourceId = `tricount-member-${participants.length}`
    nameToSourceId.set(name.toLowerCase(), sourceId)
    participants.push({ sourceId, sourceName: name })
    return sourceId
  }
  for (const membership of registry.memberships) {
    registerMember(displayName(membership))
  }

  const baseCurrencyCode = registry.currency.trim().toUpperCase()
  const expenses: NormalizedSource['expenses'] = []
  const currencyCounts = new Map<string, number>()

  for (const wrapper of registry.all_registry_entry) {
    const entry: RegistryEntry = wrapper.RegistryEntry
    const title = (entry.description ?? '').trim()
    if (title === '') continue
    const datePrefix = parseDatePrefix(entry.date)
    if (!datePrefix) continue
    const cost = Math.abs(toNumberOrNull(entry.amount.value) ?? NaN)
    if (!Number.isFinite(cost) || cost === 0) continue
    const currencyCode = entry.amount.currency.trim().toUpperCase()
    if (currencyCode.length !== 3) continue
    if (!Predicate.isString(currencyCode)) continue

    currencyCounts.set(
      currencyCode,
      (currencyCounts.get(currencyCode) ?? 0) + 1,
    )

    const typeUpper = (entry.type_transaction ?? 'NORMAL').trim().toUpperCase()
    const isBalance = typeUpper === 'BALANCE'
    const currency = getCurrency(currencyCode) ?? {
      ...FALLBACK_CURRENCY,
      code: currencyCode,
      symbol: currencyCode,
    }
    const amountCents = amountAsMinorUnitsByCode(cost, currencyCode)

    const payerName = displayName(entry.membership_owned)
    const payerSourceId = registerMember(payerName)

    const owed = new Map<string, number>()
    for (const allocation of entry.allocations) {
      const name = displayName(allocation.membership)
      const sourceId = registerMember(name)
      const share = Math.abs(toNumberOrNull(allocation.amount.value) ?? 0)
      if (share > 0) {
        owed.set(sourceId, (owed.get(sourceId) ?? 0) + share)
      }
    }

    if (isBalance) {
      let receiverId: string | null = null
      let receiverShare = 0
      for (const [sourceId, share] of owed) {
        if (sourceId !== payerSourceId && share > receiverShare) {
          receiverId = sourceId
          receiverShare = share
        }
      }
      if (!receiverId) continue
      expenses.push({
        sourceId: String(entry.id),
        title,
        expenseDate: datePrefix,
        category: 'settlement',
        amountCurrency: currencyCode,
        amount: amountCents,
        originalAmount: null,
        originalCurrency: null,
        conversionRate: null,
        paidBySourceId: payerSourceId,
        paidBy: [{ sourceId: payerSourceId, shares: amountCents }],
        paidFor: [{ sourceId: receiverId, shares: amountCents }],
        splitMode: 'EVENLY',
        recurrenceRule: 'NONE',
        notes: null,
      })
      continue
    }

    const paidForSerialized = serializePaidFor({
      splitMode: 'BY_AMOUNT',
      amount: amountCents,
      currency,
      paidFor: [...owed.entries()]
        .filter(([, share]) => share > 0)
        .map(([sourceId, share]) => ({
          participant: { id: sourceId },
          shares: share,
        })),
    })
    const paidForCents = new Map<string, number>()
    for (const row of paidForSerialized) {
      if (row.shares > 0) {
        paidForCents.set(
          row.participant.id,
          (paidForCents.get(row.participant.id) ?? 0) + row.shares,
        )
      }
    }
    const paidBySerialized = serializePaidBy({
      paidBySplitMode: 'BY_AMOUNT',
      amount: amountCents,
      inputCurrency: currency,
      paidByList: [{ participant: { id: payerSourceId }, shares: cost }],
    })
    const paidByExact = calculateExactShares({
      amount: amountCents,
      splitMode: 'BY_AMOUNT',
      participants: paidBySerialized.map((p) => ({
        id: p.participant.id,
        shares: p.shares,
      })),
    })
    const paidByFixed = distributeRemainder(paidByExact, amountCents, {
      payerId: payerSourceId,
    })
    const paidBy = Object.entries(paidByFixed).map(([sourceId, shares]) => ({
      sourceId,
      shares,
    }))
    const paidFor = [...paidForCents.entries()]
      .filter(([, shares]) => shares > 0)
      .map(([sourceId, shares]) => ({ sourceId, shares }))
    if (paidFor.length === 0) {
      paidFor.push({ sourceId: payerSourceId, shares: amountCents })
    }

    const involvedCount = new Set([
      ...paidBy.map((p) => p.sourceId),
      ...paidFor.map((p) => p.sourceId),
    ]).size
    const { splitMode, paidFor: resolvedPaidFor } = guessSplitMode(
      paidFor,
      amountCents,
      { involvedParticipantCount: involvedCount },
    )

    const exchangeRate = toNumberOrNull(entry.exchange_rate)
    expenses.push({
      sourceId: String(entry.id),
      title,
      expenseDate: datePrefix,
      category: tricountCategoryToId(
        optionalText(entry.category),
        optionalText(entry.category_custom),
        entry.type_transaction ?? 'NORMAL',
      ),
      amountCurrency: currencyCode,
      amount: amountCents,
      originalAmount: null,
      originalCurrency: null,
      conversionRate:
        exchangeRate !== null && exchangeRate !== 0
          ? Math.abs(exchangeRate)
          : null,
      paidBySourceId: payerSourceId,
      paidBy,
      paidFor: resolvedPaidFor,
      splitMode,
      recurrenceRule: 'NONE',
      notes: null,
    })
  }

  if (participants.length === 0) {
    return yield* new ImportError({
      message: 'Tricount has no participants',
      code: 'TRICOUNT_NO_PARTICIPANTS',
      params: {},
    })
  }
  if (expenses.length === 0) {
    return yield* new ImportError({
      message: 'Tricount had no parseable expenses',
      code: 'TRICOUNT_NO_PARSEABLE_EXPENSES',
      params: {},
    })
  }

  let mostCommonCurrency = baseCurrencyCode
  let maxCount = 0
  for (const [code, count] of currencyCounts) {
    if (count > maxCount) {
      maxCount = count
      mostCommonCurrency = code
    }
  }

  return {
    provider: 'TRICOUNT',
    exportVersion: null,
    sourceGroupId: `tricount-api-${registry.public_identifier_token ?? registry.title}`,
    sourceUrl,
    name: registry.title,
    information: optionalText(registry.description) || null,
    currency: mostCommonCurrency || '',
    currencyCode: mostCommonCurrency || null,
    participants,
    expenses,
    documentSource: 'NONE',
  }
})

/**
 * Normalize a raw Tricount registry API payload (decoded JSON) into an import
 * source. Failures use stable `TRICOUNT_*` codes.
 */
export const parseTricountApiResponse = Effect.fnUntraced(function* (
  payload: unknown,
  sourceUrl: string | null,
): Effect.fn.Return<NormalizedSource, ImportError> {
  const decoded = yield* Schema.decodeUnknownEffect(TricountApiResponseSchema)(
    payload,
  ).pipe(
    Effect.mapError(
      () =>
        new ImportError({
          message: 'Tricount response is not a registry payload',
          code: 'TRICOUNT_INVALID_RESPONSE',
          params: {},
        }),
    ),
  )
  const registry = decoded.Response[0]?.Registry
  if (!registry) {
    return yield* new ImportError({
      message: 'Tricount response is not a registry payload',
      code: 'TRICOUNT_INVALID_RESPONSE',
      params: {},
    })
  }
  return yield* normalizeRegistry(registry, sourceUrl)
})

/**
 * Extract the public token (`tXXX…`) from a Tricount share link or bare token.
 * Returns null when the input is neither.
 */
export function extractTricountToken(input: string): string | null {
  const trimmed = input.trim()
  if (/^t[A-Za-z0-9]+$/.test(trimmed)) return trimmed
  try {
    const url = new URL(trimmed)
    if (!url.hostname.endsWith('tricount.com')) return null
    const segments = url.pathname.split('/').filter(Boolean)
    const last = segments[segments.length - 1]
    if (last && /^t[A-Za-z0-9]+$/.test(last)) return last
    for (const key of ['public_identifier_token', 'token', 'key']) {
      const value = url.searchParams.get(key)
      if (value && /^t[A-Za-z0-9]+$/.test(value)) return value
    }
    return null
  } catch {
    return null
  }
}
