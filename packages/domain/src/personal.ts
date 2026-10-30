import { z } from 'zod'

import {
  budgetTrend,
  dateOnlyInBudgetZone,
  getBudgetPeriodBounds,
  getPreviousBudgetPeriodBounds,
  type BudgetPeriod,
  type BudgetPeriodBounds,
  type BudgetScopeMode,
} from './budgets'
import {
  categoryIdSchema,
  categoryMatchesSelection,
  isSettlementCategory,
  normalizeCategorySelection,
  type CategoryId,
} from './categories'

/**
 * Personal expenses are an account-owned ledger with no participants, splits,
 * settlements, or balances. These schemas and pure helpers are shared by the
 * API, web client, and workers. Money is always integer minor units.
 */

export const personalTransactionKindSchema = z.enum(['EXPENSE', 'INCOME'])
export type PersonalTransactionKind = z.infer<
  typeof personalTransactionKindSchema
>

export const personalTransactionSourceSchema = z.enum(['PERSONAL', 'GROUP'])
export type PersonalTransactionSource = z.infer<
  typeof personalTransactionSourceSchema
>

export const personalExpenseStateSchema = z.enum(['INCLUDE', 'EXCLUDE'])
export type PersonalExpenseState = z.infer<typeof personalExpenseStateSchema>

export const personalEntrySourceFilterSchema = z.enum([
  'ALL',
  'PERSONAL',
  'GROUP',
])
export type PersonalEntrySourceFilter = z.infer<
  typeof personalEntrySourceFilterSchema
>

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'invalidDate')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`)
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    )
  }, 'invalidDate')
const isoMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'invalidMonth')

export const personalMonthSchema = isoMonthSchema
export type PersonalMonth = z.infer<typeof personalMonthSchema>

export const personalMonthInputSchema = z.object({
  month: isoMonthSchema.optional(),
})

export const personalTransactionCreateSchema = z.object({
  kind: personalTransactionKindSchema.default('EXPENSE'),
  /** Positive minor units in `currencyCode`. */
  amount: z.number().int().positive().max(2_147_483_647, 'amountTenMillion'),
  /** Entry currency. Defaults to the profile currency at the API boundary. */
  currencyCode: z
    .string()
    .regex(/^[A-Z]{3,4}$/, 'invalidCurrency')
    .optional(),
  date: isoDateSchema,
  categoryId: categoryIdSchema.default('general'),
  title: z.string().trim().max(200).optional(),
  note: z.string().trim().max(2_000).optional(),
})
export type PersonalTransactionCreate = z.infer<
  typeof personalTransactionCreateSchema
>

/**
 * Update input intentionally omits the create-side defaults: an absent field
 * means "leave unchanged", not "reset to general/today".
 */
export const personalTransactionUpdateSchema = z.object({
  kind: personalTransactionKindSchema.optional(),
  amount: z
    .number()
    .int()
    .positive()
    .max(2_147_483_647, 'amountTenMillion')
    .optional(),
  currencyCode: z
    .string()
    .regex(/^[A-Z]{3,4}$/, 'invalidCurrency')
    .optional(),
  date: isoDateSchema.optional(),
  categoryId: categoryIdSchema.optional(),
  title: z.string().trim().max(200).optional(),
  note: z.string().trim().max(2_000).optional(),
})
export type PersonalTransactionUpdate = z.infer<
  typeof personalTransactionUpdateSchema
>

export const personalBudgetInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  amount: z.number().int().positive().max(2_147_483_647),
  period: z.literal('MONTHLY').default('MONTHLY'),
  categoryScope: z.enum(['ALL', 'SELECTED']).default('ALL'),
  categoryIds: z.array(categoryIdSchema).max(200).default([]),
  startDay: z.number().int().min(1).max(28).default(1),
})
export type PersonalBudgetInput = z.infer<typeof personalBudgetInputSchema>

export const personalGroupRuleInputSchema = z.object({
  groupId: z.string().min(1),
  included: z.boolean(),
  /** ISO date; null/undefined means all history. */
  includeFrom: isoDateSchema.nullish(),
})
export type PersonalGroupRuleInput = z.infer<
  typeof personalGroupRuleInputSchema
>

export const personalExpenseOverrideInputSchema = z.object({
  expenseId: z.string().min(1),
  state: personalExpenseStateSchema.nullish(),
  categoryId: categoryIdSchema.nullish(),
})
export type PersonalExpenseOverrideInput = z.infer<
  typeof personalExpenseOverrideInputSchema
>

export const personalEntryFilterSchema = z.object({
  month: isoMonthSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  q: z.string().trim().max(120).optional(),
  categoryIds: z.array(categoryIdSchema).max(50).optional(),
  kinds: z.array(personalTransactionKindSchema).max(2).optional(),
  source: personalEntrySourceFilterSchema.default('ALL'),
  minAmount: z.number().int().min(0).optional(),
  maxAmount: z.number().int().min(0).optional(),
  sort: z.enum(['date', 'amount']).default('date'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  cursor: z.string().max(400).optional(),
  limit: z.number().int().min(1).max(100).default(50),
})
export type PersonalEntryFilter = z.infer<typeof personalEntryFilterSchema>

export const PERSONAL_ENTRY_DEFAULT_LIMIT = 50
export const PERSONAL_ENTRY_MAX_LIMIT = 100

export type PersonalEntryCursor = {
  date: string
  id: string
  /** Present when the list is sorted by amount. */
  amount?: number
}

export const personalEntryCursorSchema = z.object({
  date: isoDateSchema,
  id: z.string().min(1),
  amount: z.number().int().optional(),
})

export function encodePersonalEntryCursor(cursor: PersonalEntryCursor): string {
  return encodeURIComponent(JSON.stringify(cursor))
}

export function decodePersonalEntryCursor(
  value: string | null | undefined,
): PersonalEntryCursor | null {
  if (!value) return null
  try {
    const parsed = personalEntryCursorSchema.safeParse(
      JSON.parse(decodeURIComponent(value)),
    )
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * A month's calendar bounds in the personal profile time zone. `month` is
 * `YYYY-MM`; absent means the current month. The returned dates are UTC
 * midnights, matching budget and expense-date comparisons.
 */
export function getPersonalMonthBounds(
  month: string | null | undefined,
  timeZone: string,
  at: Date = new Date(),
): BudgetPeriodBounds {
  const anchor = month ? new Date(`${month}-15T12:00:00.000Z`) : at
  if (Number.isNaN(anchor.getTime())) {
    throw new Error(`Invalid month: ${month}`)
  }
  return getBudgetPeriodBounds(
    {
      period: 'MONTHLY',
      amount: 0,
      timeZone,
      categoryScope: 'ALL',
      categoryNodeIds: [],
      participantScope: 'ALL',
      participantIds: [],
    },
    anchor,
  )
}

export function getPreviousPersonalMonthBounds(
  bounds: BudgetPeriodBounds,
): BudgetPeriodBounds {
  const previous = getPreviousBudgetPeriodBounds(
    {
      period: 'MONTHLY',
      amount: 0,
      timeZone: bounds.timeZone ?? 'UTC',
      categoryScope: 'ALL',
      categoryNodeIds: [],
      participantScope: 'ALL',
      participantIds: [],
    },
    bounds,
  )
  return previous ?? bounds
}

export type PersonalInclusionInput = {
  /** Account-level master gate. */
  masterEnabled: boolean
  rule: {
    included: boolean
    includeFrom: Date | string | null
  } | null
  override: {
    state: PersonalExpenseState | null
    categoryId?: string | null
  } | null
  expense: {
    categoryId: string
    /** Instant of the source expense. */
    date: Date | string
  }
  profileTimeZone: string
  /** The account holder's signed share in the ledger currency. */
  share: number
}

export type PersonalInclusionResult = {
  included: boolean
  /** Calendar date in the profile time zone. */
  date: Date
  /** Effective personal category (override wins). */
  categoryId: string
}

/**
 * Single source of truth for whether a group/friend expense lands in a personal
 * ledger. The master gate is checked first; a per-expense INCLUDE pins an
 * expense even when its group rule is off, and EXCLUDE always wins.
 *
 * Settlements and zero/absent shares never land: they are not personal
 * spending, and counting them would double the ledger.
 */
export function resolvePersonalInclusion(
  input: PersonalInclusionInput,
): PersonalInclusionResult {
  const date = dateOnlyInBudgetZone(
    new Date(input.expense.date),
    input.profileTimeZone,
  )
  const categoryId = input.override?.categoryId ?? input.expense.categoryId

  if (isSettlementCategory(categoryId)) {
    return { included: false, date, categoryId }
  }
  if (!Number.isFinite(input.share) || input.share === 0) {
    return { included: false, date, categoryId }
  }
  if (!input.masterEnabled) {
    return { included: false, date, categoryId }
  }
  if (input.override?.state === 'EXCLUDE') {
    return { included: false, date, categoryId }
  }
  if (input.override?.state === 'INCLUDE') {
    return { included: true, date, categoryId }
  }
  if (!input.rule?.included) {
    return { included: false, date, categoryId }
  }
  if (input.rule.includeFrom) {
    // `includeFrom` is a calendar date (Prisma @db.Date), already stored as a
    // UTC midnight. Do not re-interpret it in the profile zone: negative UTC
    // offsets would shift the boundary a day earlier.
    const from = new Date(input.rule.includeFrom)
    if (date < from) {
      return { included: false, date, categoryId }
    }
  }
  return { included: true, date, categoryId }
}

export type PersonalBudgetMatchInput = {
  categoryScope: BudgetScopeMode
  categoryIds: readonly string[]
}

/** Whether an expense category contributes to a personal budget. */
export function personalBudgetMatchesCategory(
  budget: PersonalBudgetMatchInput,
  categoryId: string,
): boolean {
  if (budget.categoryScope === 'ALL') return true
  return categoryMatchesSelection(categoryId as CategoryId, budget.categoryIds)
}

/** Normalize a personal budget's selected category ids for storage. */
export function normalizePersonalBudgetCategories(
  selectedIds: readonly string[],
): string[] {
  return normalizeCategorySelection(selectedIds)
}

export type PersonalBudgetEntry = {
  kind: PersonalTransactionKind
  categoryId: string
  amount: number
  date: Date | string
}

/**
 * Personal budgets sum signed expense amounts in the selected categories.
 * Income is excluded; refunds (negative linked shares) reduce usage.
 */
export function calculatePersonalBudgetUsage(
  budget: PersonalBudgetMatchInput,
  entries: readonly PersonalBudgetEntry[],
  bounds: BudgetPeriodBounds,
): number {
  return entries.reduce((total, entry) => {
    if (entry.kind !== 'EXPENSE') return total
    if (!personalBudgetMatchesCategory(budget, entry.categoryId)) return total
    const date = new Date(entry.date)
    if (Number.isNaN(date.getTime())) return total
    if (date < bounds.start || date > bounds.end) return total
    return total + entry.amount
  }, 0)
}

export type PersonalBudgetStatus = {
  spent: number
  remaining: number
  /** 0..∞; can exceed 1 when over budget. */
  ratio: number
  projected: number
  trendingOver: boolean
  over: boolean
  state: 'OK' | 'TRENDING' | 'OVER'
}

export function getPersonalBudgetStatus(
  budget: PersonalBudgetMatchInput & { amount: number },
  entries: readonly PersonalBudgetEntry[],
  bounds: BudgetPeriodBounds,
  at: Date = new Date(),
): PersonalBudgetStatus {
  const spent = calculatePersonalBudgetUsage(budget, entries, bounds)
  const remaining = budget.amount - spent
  const trend = budgetTrend(spent, budget.amount, bounds, at)
  const ratio = budget.amount > 0 ? spent / budget.amount : 0
  return {
    spent,
    remaining,
    ratio,
    projected: trend.projected,
    trendingOver: trend.trending,
    over: trend.over,
    state: trend.over ? 'OVER' : trend.trending ? 'TRENDING' : 'OK',
  }
}

/**
 * The overall budget shown in the personal hero: the single ALL-scoped budget
 * when present, otherwise the sum of category budgets (the API enforces that
 * SELECTED budgets do not overlap, so the sum is meaningful).
 */
export function pickOverallPersonalBudget<
  T extends { categoryScope: BudgetScopeMode; amount: number },
>(budgets: readonly T[]): T | null {
  return budgets.find((budget) => budget.categoryScope === 'ALL') ?? null
}

export function sumPersonalBudgetAmounts(
  budgets: readonly { amount: number }[],
): number {
  return budgets.reduce((total, budget) => total + budget.amount, 0)
}

export function isPersonalBudgetPeriodSupported(period: BudgetPeriod): boolean {
  return period === 'MONTHLY'
}
