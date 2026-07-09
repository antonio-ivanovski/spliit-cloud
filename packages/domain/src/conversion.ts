import * as z from 'zod'

/**
 * How a converted expense got its rate. Same-currency expenses store
 * `null` in the DB — there is no `NONE` value.
 */
export const ConversionSource = {
  EXCHANGE: 'EXCHANGE',
  CUSTOM: 'CUSTOM',
} as const

export type ConversionSource =
  (typeof ConversionSource)[keyof typeof ConversionSource]

const conversionSourceValues = [
  ConversionSource.EXCHANGE,
  ConversionSource.CUSTOM,
] as const satisfies readonly [ConversionSource, ...ConversionSource[]]

/** Shared Zod schema for EXCHANGE | CUSTOM (no NONE). */
export const conversionSourceSchema = z.enum(conversionSourceValues)

export type ConversionSourceSchema = z.infer<typeof conversionSourceSchema>

const conversionCurrencySchema = z
  .string()
  .min(1, 'currencyRequired')
  .refine((c) => c.length <= 16, 'currencyTooLong')

/**
 * Present only when the expense currency differs from the ledger base.
 * Same-currency expenses omit conversion entirely (undefined / absent),
 * matching nullable DB columns.
 */
export const expenseConversionInputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('custom'),
    currency: conversionCurrencySchema,
    rate: z.number().positive('ratePositive'),
  }),
  z.object({
    type: z.literal('exchange'),
    currency: conversionCurrencySchema,
  }),
])

export type ExpenseConversionInput = z.infer<
  typeof expenseConversionInputSchema
>

/** Optional on expense payloads: absent means same currency as the group/ledger. */
export const optionalExpenseConversionSchema =
  expenseConversionInputSchema.optional()

export function isConvertedConversion(
  conversion: ExpenseConversionInput | null | undefined,
): conversion is ExpenseConversionInput {
  return conversion != null
}

export function conversionCurrency(
  conversion: ExpenseConversionInput | null | undefined,
): string | null {
  return conversion?.currency ?? null
}

/** Map a stored DB row into the API conversion discriminant (or undefined). */
export function conversionFromStored(row: {
  conversionSource: ConversionSource | null | undefined
  originalCurrency: string | null | undefined
  conversionRate: number | null | undefined
}): ExpenseConversionInput | undefined {
  if (row.conversionSource === 'CUSTOM') {
    return {
      type: 'custom',
      currency: row.originalCurrency ?? '',
      rate: Number(row.conversionRate) || 1,
    }
  }
  if (row.conversionSource === 'EXCHANGE') {
    return {
      type: 'exchange',
      currency: row.originalCurrency ?? '',
    }
  }
  // Legacy: rate + currency without source → custom
  if (row.originalCurrency && row.conversionRate != null) {
    return {
      type: 'custom',
      currency: row.originalCurrency,
      rate: Number(row.conversionRate),
    }
  }
  return undefined
}

/** Flat columns persisted on Expense for a resolved conversion. */
export type StoredConversionFields = {
  originalAmount: number | null
  originalCurrency: string | null
  conversionRate: number | null
  conversionSource: ConversionSource | null
}

/** UTC calendar date as `YYYY-MM-DD`. */
export function utcTodayIso(now: Date = new Date()): string {
  const yyyy = now.getUTCFullYear()
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(now.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * EXCHANGE rate lookup date: expense date for past/today, today when the
 * expense date is in the future. Client preview and server persistence
 * both use this rule so they request the same provider date.
 */
export function exchangeRateLookupDate(
  expenseDateIso: string,
  todayIso: string = utcTodayIso(),
): string {
  return expenseDateIso > todayIso ? todayIso : expenseDateIso
}
