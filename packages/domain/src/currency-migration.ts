import * as z from 'zod'
import { ConversionSource } from './conversion'
import { supportedCurrencyCodes } from './currency'
import { convertMinorUnitsByRate } from './utils'

export const migrationPairPolicySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('perDate') }),
  z.object({ type: z.literal('fixedProvider'), date: z.string().date() }),
  z.object({
    type: z.literal('fixedCustom'),
    rate: z.number().finite().positive(),
  }),
])

export type MigrationPairPolicy = z.infer<typeof migrationPairPolicySchema>

export type EffectiveOriginalExpense = {
  id: string
  expenseDate: Date | string
  effectiveOriginalAmount: number
  effectiveOriginalCurrency: string
  existingConversionSource: 'EXCHANGE' | 'CUSTOM' | null | undefined
}

export type MigrationExpenseInput = {
  id: string
  expenseDate: Date | string
  amount: number
  originalAmount?: number | null
  originalCurrency?: string | null
  conversionSource?: 'EXCHANGE' | 'CUSTOM' | null
}

export type MigrationCurrencyIssue = {
  code: string
  expenseIds: string[]
}

export type MigrationPair = {
  base: string
  target: string
  expenseIds: string[]
  dates: string[]
}

export type MigrationEligibility = {
  eligible: boolean
  unsupportedCurrencies: MigrationCurrencyIssue[]
  pairs: MigrationPair[]
  customRateExpenseCount: number
}

export type MigrationRewrite = {
  amount: number
  originalAmount: number | null
  originalCurrency: string | null
  conversionRate: number | null
  conversionSource: 'EXCHANGE' | 'CUSTOM' | null
}

export type MigrationRateByDate = Record<string, number>

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/

function normalizedCode(code: string): string {
  return code.trim().toUpperCase()
}

function dateOnly(value: Date | string): string {
  if (typeof value === 'string' && isoDatePattern.test(value.slice(0, 10))) {
    return value.slice(0, 10)
  }
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('Invalid expense date')
  return date.toISOString().slice(0, 10)
}

export function isSupportedMigrationCurrency(code: string | null | undefined) {
  return (
    !!code &&
    (supportedCurrencyCodes as readonly string[]).includes(normalizedCode(code))
  )
}

export function effectiveOriginalExpense(
  expense: MigrationExpenseInput,
  oldLedgerCurrency: string,
): EffectiveOriginalExpense {
  const originalCurrency = expense.originalCurrency?.trim()
  const hasOriginal = !!originalCurrency && expense.originalAmount != null
  return {
    id: expense.id,
    expenseDate: expense.expenseDate,
    effectiveOriginalAmount: hasOriginal
      ? Number(expense.originalAmount)
      : Number(expense.amount),
    effectiveOriginalCurrency: normalizedCode(
      hasOriginal ? originalCurrency! : oldLedgerCurrency,
    ),
    existingConversionSource: expense.conversionSource,
  }
}

export function classifyMigrationExpenses(
  expenses: MigrationExpenseInput[],
  oldLedgerCurrency: string,
): EffectiveOriginalExpense[] {
  return expenses.map((expense) =>
    effectiveOriginalExpense(expense, oldLedgerCurrency),
  )
}

export function getMigrationEligibility(args: {
  oldLedgerCurrency: string | null | undefined
  destinationCurrency: string | null | undefined
  expenses: MigrationExpenseInput[]
}): MigrationEligibility {
  const oldCurrency = normalizedCode(args.oldLedgerCurrency ?? '')
  const destination = normalizedCode(args.destinationCurrency ?? '')
  const effective = classifyMigrationExpenses(args.expenses, oldCurrency)
  const affectedByCode = new Map<string, Set<string>>()

  const addIssue = (code: string, expenseId?: string) => {
    const ids = affectedByCode.get(code) ?? new Set<string>()
    if (expenseId) ids.add(expenseId)
    affectedByCode.set(code, ids)
  }

  if (!isSupportedMigrationCurrency(oldCurrency)) addIssue(oldCurrency)
  if (!isSupportedMigrationCurrency(destination)) addIssue(destination)
  for (const expense of effective) {
    if (!isSupportedMigrationCurrency(expense.effectiveOriginalCurrency)) {
      addIssue(expense.effectiveOriginalCurrency, expense.id)
    }
  }

  const pairsByKey = new Map<string, MigrationPair>()
  for (const expense of effective) {
    if (expense.effectiveOriginalCurrency === destination) continue
    const key = `${expense.effectiveOriginalCurrency}|${destination}`
    const pair = pairsByKey.get(key)
    if (pair) {
      pair.expenseIds.push(expense.id)
      const date = dateOnly(expense.expenseDate)
      if (!pair.dates.includes(date)) pair.dates.push(date)
    } else {
      pairsByKey.set(key, {
        base: expense.effectiveOriginalCurrency,
        target: destination,
        expenseIds: [expense.id],
        dates: [dateOnly(expense.expenseDate)],
      })
    }
  }

  return {
    eligible: affectedByCode.size === 0,
    unsupportedCurrencies: [...affectedByCode.entries()].map(
      ([code, expenseIds]) => ({ code, expenseIds: [...expenseIds] }),
    ),
    pairs: [...pairsByKey.values()],
    customRateExpenseCount: args.expenses.filter(
      (expense) => expense.conversionSource === ConversionSource.CUSTOM,
    ).length,
  }
}

export function migrationRateKey(date: string, base: string, target: string) {
  return `${date}|${normalizedCode(base)}|${normalizedCode(target)}`
}

export function calculateMigrationRewrite(args: {
  expense: EffectiveOriginalExpense
  oldLedgerCurrency: string
  destinationCurrency: string
  policy: MigrationPairPolicy
  ratesByDate?: MigrationRateByDate
}): MigrationRewrite {
  const base = args.expense.effectiveOriginalCurrency
  const target = normalizedCode(args.destinationCurrency)
  if (base === target) {
    return {
      amount: args.expense.effectiveOriginalAmount,
      originalAmount: null,
      originalCurrency: null,
      conversionRate: null,
      conversionSource: null,
    }
  }

  const rate =
    args.policy.type === 'fixedCustom'
      ? args.policy.rate
      : args.ratesByDate?.[
          migrationRateKey(
            args.policy.type === 'fixedProvider'
              ? args.policy.date
              : dateOnly(args.expense.expenseDate),
            base,
            target,
          )
        ]
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Missing positive migration rate for ${base} -> ${target}`)
  }

  return {
    amount: convertMinorUnitsByRate(
      args.expense.effectiveOriginalAmount,
      rate,
      base,
      target,
    ),
    originalAmount: args.expense.effectiveOriginalAmount,
    originalCurrency: base,
    conversionRate: rate,
    conversionSource:
      args.policy.type === 'perDate'
        ? ConversionSource.EXCHANGE
        : ConversionSource.CUSTOM,
  }
}
