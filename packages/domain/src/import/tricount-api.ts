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

import { Effect, Schema } from 'effect'

import { getCurrency } from '../currency'
import { amountAsMinorUnitsByCode } from '../utils'
import { buildOwedExpense, buildSettlement } from './expense-builder'
import { createMemberRegistry } from './member-registry'
import {
  dominantCurrency,
  FALLBACK_CURRENCY,
  optionalText,
  parseIsoDatePrefix,
  toNumberOrNullApi,
} from './table'
import { tricountCategoryToId } from './tricount-categories'
import { ImportError } from './types'
import type { NormalizedSource } from './types'

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

const normalizeRegistry = Effect.fnUntraced(function* (
  registry: Registry,
  sourceUrl: string | null,
): Effect.fn.Return<NormalizedSource, ImportError> {
  const registry_ = createMemberRegistry('tricount-member')
  const registerMember = registry_.register
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
    const datePrefix = parseIsoDatePrefix(entry.date)
    if (!datePrefix) continue
    const cost = Math.abs(toNumberOrNullApi(entry.amount.value) ?? NaN)
    if (!Number.isFinite(cost) || cost === 0) continue
    const currencyCode = entry.amount.currency.trim().toUpperCase()
    if (currencyCode.length !== 3) continue

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
      const share = Math.abs(toNumberOrNullApi(allocation.amount.value) ?? 0)
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
      const settlement = buildSettlement({
        payerId: payerSourceId,
        receiverId,
        amountCents,
      })
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
        ...settlement,
        recurrenceRule: 'NONE',
        notes: null,
      })
      continue
    }

    const built = buildOwedExpense({
      amountCents,
      currency,
      owedMajors: owed,
      advancedMajors: new Map([[payerSourceId, cost]]),
      payerId: payerSourceId,
    })
    const { splitMode, paidFor: resolvedPaidFor } = built
    const paidBy = built.paidBy

    const exchangeRate = toNumberOrNullApi(entry.exchange_rate)
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

  const participants = registry_.all()
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

  const votedCurrency = dominantCurrency(currencyCounts)
  const mostCommonCurrency = votedCurrency || baseCurrencyCode

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
