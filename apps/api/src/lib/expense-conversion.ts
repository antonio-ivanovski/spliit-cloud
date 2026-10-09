import { TRPCError } from '@trpc/server'

import {
  convertMinorUnitsByRate,
  conversionMinorScale,
  exchangeRateLookupDate,
  utcTodayIso,
  type ConversionSource,
  type Expense,
  type ExpenseConversionInput,
  type StoredConversionFields,
} from '@spliit/domain'
import { supportedCurrencyCodes } from '@spliit/domain/currency'

import { UnsupportedCurrencyError } from './currency-errors'
import { getCurrencyRate, type CurrencyRate } from './currency-rates'

export class ConversionError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'INVALID_SOURCE_FOR_CURRENCY'
      | 'INVALID_DATE'
      | 'CURRENCY_LOOKUP_FAILED'
      | 'PROVIDER_UNAVAILABLE'
      | 'RATE_NOT_POSITIVE'
      | 'AMOUNT_SIGN_MISMATCH',
  ) {
    super(message)
    this.name = 'ConversionError'
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isSupportedIso(code: string | null | undefined): boolean {
  if (!code) return false
  return (supportedCurrencyCodes as readonly string[]).includes(code)
}

function isCustomCode(code: string | null | undefined): boolean {
  return !code || code === ''
}

export type ConversionResolution = StoredConversionFields & {
  ledgerAmountMinor: number
  /** Expense-currency minor units (input amount). */
  inputAmountMinor: number
}

export type ConversionResolverOptions = {
  fetchImpl?: typeof getCurrencyRate
  /**
   * Preserve a stored EXCHANGE rate across edits (issue #155). When the
   * incoming `exchange` currency and lookup date match the stored expense, the
   * stored rate is reused instead of re-fetching the provider, so unrelated
   * edits don't silently move the ledger total. Amount changes keep the rate
   * and rescale the total; currency/date changes re-fetch.
   */
  preserveExchange?: PreservedExchangeRate
}

/** Stored EXCHANGE identity used to decide whether an edit may reuse its rate. */
export type PreservedExchangeRate = {
  originalCurrency: string | null
  conversionRate: number | null
  /** Clamped provider lookup date (`exchangeRateLookupDate`) of the stored row. */
  lookupDateIso: string
  ledgerCurrency: string | null
}

export function toIsoDate(value: Date | string): string {
  if (typeof value === 'string') {
    const slice = value.slice(0, 10)
    if (ISO_DATE_RE.test(slice)) return slice
  }
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) {
    throw new ConversionError(`Invalid expense date`, 'INVALID_DATE')
  }
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** Provider lookup date for an expense instant (UTC convention + future clamp). */
export function exchangeLookupDateForExpenseDate(
  expenseDate: Date | string,
  todayIso?: string,
): string {
  return exchangeRateLookupDate(
    toIsoDate(expenseDate),
    todayIso ?? utcTodayIso(),
  )
}

/**
 * Build a `preserveExchange` snapshot from a stored row. Returns undefined when
 * the row has no reusable EXCHANGE rate.
 */
export function preservedExchangeFromStored(
  row: {
    originalCurrency: string | null | undefined
    conversionRate: number | null | undefined
    expenseDate: Date | string
  },
  ledgerCurrency: string | null,
  todayIso?: string,
): PreservedExchangeRate | undefined {
  if (!row.originalCurrency) return undefined
  const rate = row.conversionRate == null ? NaN : Number(row.conversionRate)
  if (!Number.isFinite(rate) || rate <= 0) return undefined
  return {
    originalCurrency: row.originalCurrency,
    conversionRate: rate,
    lookupDateIso: exchangeLookupDateForExpenseDate(row.expenseDate, todayIso),
    ledgerCurrency,
  }
}

/**
 * Resolve how the server should convert an expense into the Ledger base
 * currency from the optional discriminated `conversion` input.
 *
 * - Absent / undefined → same currency as ledger; no rate/source stored
 * - `custom` → apply client rate; store CUSTOM
 * - `exchange` → fetch provider rate; store EXCHANGE (client rate ignored)
 */
export async function resolveConversion(
  expense: Pick<Expense, 'amount'> & {
    conversion?: ExpenseConversionInput | null
  },
  ctx: {
    ledgerCurrency: string | null
    expenseDate: Date | string
  },
  opts: ConversionResolverOptions = {},
): Promise<ConversionResolution> {
  const expenseDateIso = toIsoDate(ctx.expenseDate)
  const amountMinor = Number(expense.amount)
  const conversion = expense.conversion ?? undefined

  if (!Number.isFinite(amountMinor) || amountMinor === 0) {
    return sameCurrencyResolution(amountMinor)
  }

  // No conversion field → expense uses the group/ledger currency.
  if (!conversion) {
    return sameCurrencyResolution(amountMinor)
  }

  const expenseCurrency = conversion.currency
  const ledgerIsCustom = isCustomCode(ctx.ledgerCurrency)
  const expenseIsCustom = isCustomCode(expenseCurrency)
  const ledgerIso = ledgerIsCustom ? null : ctx.ledgerCurrency
  const expenseIso = expenseIsCustom ? null : expenseCurrency

  const sameCurrency =
    (expenseIsCustom && ledgerIsCustom) ||
    (expenseIso !== null && ledgerIso !== null && expenseIso === ledgerIso)

  if (sameCurrency) {
    return sameCurrencyResolution(amountMinor)
  }

  if (conversion.type === 'exchange') {
    if (!isSupportedIso(expenseIso) || !isSupportedIso(ledgerIso)) {
      throw new ConversionError(
        `EXCHANGE requires supported ISO currency for both expense and ledger base.`,
        'INVALID_SOURCE_FOR_CURRENCY',
      )
    }
    const preserved = tryPreservedExchange({
      expenseIso: expenseIso!,
      ledgerIso: ledgerIso!,
      requestedDateIso: expenseDateIso,
      amountMinor,
      preserve: opts.preserveExchange,
    })
    if (preserved) return preserved
    return resolveExchange({
      expenseCurrency: expenseIso!,
      ledgerCurrency: ledgerIso!,
      requestedDateIso: expenseDateIso,
      amountMinor,
      fetchImpl: opts.fetchImpl,
    })
  }

  if (conversion.type === 'exact') {
    const ledgerAmountMinor = Number(conversion.amount)
    if (
      !Number.isInteger(ledgerAmountMinor) ||
      ledgerAmountMinor === 0 ||
      Math.sign(ledgerAmountMinor) !== Math.sign(amountMinor)
    ) {
      throw new ConversionError(
        'EXACT conversion amounts must be nonzero and have matching signs.',
        'AMOUNT_SIGN_MISMATCH',
      )
    }
    const rate =
      ledgerAmountMinor /
      (amountMinor *
        conversionMinorScale(1, expenseCurrency, ctx.ledgerCurrency))
    return {
      conversionSource: 'EXACT',
      conversionRate: rate,
      originalAmount: amountMinor,
      originalCurrency: expenseCurrency,
      ledgerAmountMinor,
      inputAmountMinor: amountMinor,
    }
  }

  // custom
  const rate = Number(conversion.rate)
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new ConversionError(
      'CUSTOM conversion requires a positive rate.',
      'RATE_NOT_POSITIVE',
    )
  }
  return {
    conversionSource: 'CUSTOM',
    conversionRate: rate,
    originalAmount: amountMinor,
    originalCurrency: expenseCurrency,
    ledgerAmountMinor: convertMinorUnitsByRate(
      amountMinor,
      rate,
      expenseCurrency,
      ctx.ledgerCurrency,
    ),
    inputAmountMinor: amountMinor,
  }
}

function sameCurrencyResolution(amountMinor: number): ConversionResolution {
  return {
    conversionSource: null,
    conversionRate: null,
    originalAmount: null,
    originalCurrency: null,
    ledgerAmountMinor: amountMinor,
    inputAmountMinor: amountMinor,
  }
}

function tryPreservedExchange(args: {
  expenseIso: string
  ledgerIso: string
  requestedDateIso: string
  amountMinor: number
  preserve: PreservedExchangeRate | undefined
}): ConversionResolution | undefined {
  const preserve = args.preserve
  if (!preserve) return undefined
  const rate =
    preserve.conversionRate == null ? NaN : Number(preserve.conversionRate)
  if (!Number.isFinite(rate) || rate <= 0) return undefined
  if (preserve.originalCurrency !== args.expenseIso) return undefined
  if (preserve.ledgerCurrency !== args.ledgerIso) return undefined
  if (
    preserve.lookupDateIso !== exchangeRateLookupDate(args.requestedDateIso)
  ) {
    return undefined
  }
  return {
    conversionSource: 'EXCHANGE' satisfies ConversionSource,
    conversionRate: rate,
    originalAmount: args.amountMinor,
    originalCurrency: args.expenseIso,
    ledgerAmountMinor: convertMinorUnitsByRate(
      args.amountMinor,
      rate,
      args.expenseIso,
      args.ledgerIso,
    ),
    inputAmountMinor: args.amountMinor,
  }
}

async function resolveExchange(args: {
  expenseCurrency: string
  ledgerCurrency: string
  requestedDateIso: string
  amountMinor: number
  fetchImpl?: typeof getCurrencyRate
}): Promise<ConversionResolution> {
  // Future expense dates use today's rate (shared domain rule).
  const lookupDate = exchangeRateLookupDate(args.requestedDateIso)
  const fetchImpl = args.fetchImpl ?? getCurrencyRate
  let rate: CurrencyRate
  try {
    rate = await fetchImpl({
      date: lookupDate,
      base: args.expenseCurrency,
      target: args.ledgerCurrency,
    })
  } catch (err) {
    // TRPCError passes through unwrapped: cached batch resolvers throw coded
    // errors (BAD_GATEWAY for provider gaps, INTERNAL for cache-invariant
    // violations) that must survive with their code intact instead of being
    // relabeled PROVIDER_UNAVAILABLE below.
    if (err instanceof TRPCError) throw err
    if (err instanceof UnsupportedCurrencyError) {
      throw new ConversionError(
        `Unsupported currency for EXCHANGE: ${err.code}`,
        'CURRENCY_LOOKUP_FAILED',
      )
    }
    throw new ConversionError(
      err instanceof Error ? err.message : 'Currency rate provider unavailable',
      'PROVIDER_UNAVAILABLE',
    )
  }
  return {
    conversionSource: 'EXCHANGE' satisfies ConversionSource,
    conversionRate: rate.rate,
    originalAmount: args.amountMinor,
    originalCurrency: args.expenseCurrency,
    ledgerAmountMinor: convertMinorUnitsByRate(
      args.amountMinor,
      rate.rate,
      args.expenseCurrency,
      args.ledgerCurrency,
    ),
    inputAmountMinor: args.amountMinor,
  }
}
