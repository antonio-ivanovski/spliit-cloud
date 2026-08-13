import { getBalances } from './balances'
import { isSettlementCategory } from './categories'
import type { ConversionSource } from './conversion'
import type { Currency } from './currency'
import type { SplitMode } from './enums'
import {
  addExactAmount,
  convertByRate,
  exactFromFraction,
  exactFromInteger,
  exactZero,
  type ExactAmount,
  type ParticipantShare,
} from './exact-math'
import { distributeRemainder } from './remainder-distribution'
import { sharesAsFixedUnits } from './shares'
import { amountAsMinorUnits, expenseIdSeed } from './utils'

export type TotalsExpense = {
  id?: string
  amount: number
  splitMode: SplitMode
  paidBySplitMode: SplitMode
  categoryId?: string | null
  paidByList: Array<{
    shares: number
    participant: { id: string; name?: string }
  }>
  paidFor: Array<{
    shares: number
    participant: { id: string; name?: string }
  }>
  originalAmount?: number | null
  originalCurrency?: string | null
  conversionRate?: number | string | null
  conversionSource?: ConversionSource | null
  expenseDate?: Date | string | number | null
  [key: string]: unknown
}

export type SplitInput = {
  amount: number
  splitMode: SplitMode
  participants: Array<{ id: string; shares: number }>
}

function isConverted(expense: {
  conversionSource?: ConversionSource | null
  originalCurrency?: string | null
  conversionRate?: number | string | null
}): boolean {
  // EXCHANGE | CUSTOM means converted; null/undefined means same currency.
  if (
    expense.conversionSource === 'EXCHANGE' ||
    expense.conversionSource === 'CUSTOM'
  ) {
    return true
  }
  return Boolean(expense.originalCurrency && expense.conversionRate)
}

type SharesExpense = Pick<
  TotalsExpense,
  | 'amount'
  | 'splitMode'
  | 'paidFor'
  | 'categoryId'
  | 'originalAmount'
  | 'originalCurrency'
  | 'conversionRate'
  | 'conversionSource'
> & {
  id?: string | null
  paidByList?: TotalsExpense['paidByList']
}

type PaidBySharesExpense = Pick<
  TotalsExpense,
  | 'amount'
  | 'paidByList'
  | 'paidBySplitMode'
  | 'categoryId'
  | 'originalAmount'
  | 'originalCurrency'
  | 'conversionRate'
  | 'conversionSource'
> & {
  id?: string | null
}

/** Exact rational per-participant shares for all split modes. */
export function calculateExactShares(
  input: SplitInput,
): Record<string, ExactAmount> {
  const { amount, splitMode, participants } = input
  if (participants.length === 0) return {}

  const result: Record<string, ExactAmount> = {}
  if (amount === 0) {
    for (const p of participants) result[p.id] = exactZero()
    return result
  }

  switch (splitMode) {
    case 'EVENLY': {
      const share = exactFromFraction(
        BigInt(amount),
        BigInt(participants.length),
      )
      for (const p of participants) {
        result[p.id] = addExactAmount(result[p.id] ?? exactZero(), share)
      }
      break
    }
    case 'BY_SHARES': {
      const totalShares = participants.reduce((sum, p) => sum + p.shares, 0)
      if (totalShares === 0) {
        for (const p of participants) {
          result[p.id] = result[p.id] ?? exactZero()
        }
        break
      }
      for (const p of participants) {
        result[p.id] = addExactAmount(
          result[p.id] ?? exactZero(),
          exactFromFraction(
            BigInt(amount) * BigInt(p.shares),
            BigInt(totalShares),
          ),
        )
      }
      break
    }
    case 'BY_PERCENTAGE': {
      for (const p of participants) {
        result[p.id] = addExactAmount(
          result[p.id] ?? exactZero(),
          exactFromFraction(BigInt(amount) * BigInt(p.shares), 10000n),
        )
      }
      break
    }
    case 'BY_AMOUNT':
    case 'ITEMIZED': {
      for (const p of participants) {
        result[p.id] = addExactAmount(
          result[p.id] ?? exactZero(),
          exactFromInteger(p.shares),
        )
      }
      break
    }
  }

  return result
}

/** Per-expense integer paidFor shares; sum === expense.amount. */
export function calculateShares(
  expense: SharesExpense,
): Record<string, number> {
  const paidFor = expense.paidFor
  if (paidFor.length === 0) return {}

  const converted = isConverted(expense)
  const hasRate = Boolean(expense.conversionRate)
  // BY_AMOUNT cross-currency: paidFor shares are original-currency minor
  // units (sum === originalAmount). EVENLY/PERCENTAGE/SHARES are computed
  // from the ledger total directly and are unaffected. ITEMIZED treats
  // original-currency weights as BY_SHARES against the ledger total.
  let splitMode: SplitMode =
    expense.splitMode === 'ITEMIZED' && converted && hasRate
      ? 'BY_SHARES'
      : expense.splitMode

  let sharesAmount = expense.amount
  if (converted && hasRate && expense.splitMode === 'BY_AMOUNT') {
    // shares are in original-currency minor units; normalize them as a
    // fractional sum against the originalAmount so the per-participant
    // fractions can be re-multiplied against the ledger total.
    const originalAmount = expense.originalAmount ?? expense.amount
    sharesAmount = originalAmount
    splitMode = 'BY_AMOUNT'
  }

  const exact = calculateExactShares({
    amount: sharesAmount,
    splitMode,
    participants: paidFor.map((p) => ({
      id: p.participant.id,
      shares: Number(p.shares),
    })),
  })

  let distributable: Record<string, ExactAmount> = exact
  if (converted && hasRate && expense.splitMode === 'BY_AMOUNT') {
    // Scale original-currency minor units to ledger minor units. Prefer
    // amount/originalAmount so decimal_digits differences match the stored
    // ledger total (major-unit FX rate alone is wrong for e.g. USD→JPY).
    const originalAmount = expense.originalAmount ?? expense.amount
    const scale =
      originalAmount !== 0
        ? expense.amount / originalAmount
        : Number(expense.conversionRate)
    distributable = {}
    for (const [id, share] of Object.entries(exact)) {
      distributable[id] = convertByRate(share, scale)
    }
  }

  const seed = expenseIdSeed(expense.id)
  const payerId =
    !converted &&
    (expense.splitMode === 'BY_AMOUNT' || expense.splitMode === 'ITEMIZED')
      ? expense.paidByList?.[0]?.participant.id
      : undefined

  return distributeRemainder(distributable, expense.amount, { seed, payerId })
}

/** Per-expense integer paidBy shares in ledger currency; sum === expense.amount. */
export function calculatePaidByShares(
  expense: PaidBySharesExpense,
): Record<string, number> {
  const paidBys = expense.paidByList
  if (paidBys.length === 0) return {}

  const converted = isConverted(expense)
  const hasRate = Boolean(expense.conversionRate)
  const payerBase = converted
    ? (expense.originalAmount ?? expense.amount)
    : expense.amount

  // paidBySplitMode ITEMIZED is a dead path; treat as BY_AMOUNT
  const splitMode: SplitMode =
    expense.paidBySplitMode === 'ITEMIZED'
      ? 'BY_AMOUNT'
      : expense.paidBySplitMode

  let exact = calculateExactShares({
    amount: payerBase,
    splitMode,
    participants: paidBys.map((p) => ({
      id: p.participant.id,
      shares: Number(p.shares),
    })),
  })

  if (converted && hasRate) {
    const originalAmount = expense.originalAmount ?? expense.amount
    const scale =
      originalAmount !== 0
        ? expense.amount / originalAmount
        : Number(expense.conversionRate)
    const convertedExact: Record<string, ExactAmount> = {}
    for (const [id, share] of Object.entries(exact)) {
      convertedExact[id] = convertByRate(share, scale)
    }
    exact = convertedExact
  }

  const seed = expenseIdSeed(expense.id)
  const payerId =
    !converted &&
    (expense.paidBySplitMode === 'BY_AMOUNT' ||
      expense.paidBySplitMode === 'ITEMIZED')
      ? paidBys[0]?.participant.id
      : undefined

  return distributeRemainder(exact, expense.amount, { seed, payerId })
}

export function calculatePaidByShare(
  participantId: string | null,
  expense: PaidBySharesExpense,
): number {
  if (isSettlementCategory(expense.categoryId)) return 0
  if (participantId == null) return 0
  return calculatePaidByShares(expense)[participantId] ?? 0
}

export function calculateShare(
  participantId: string | null,
  expense: SharesExpense,
): number {
  if (isSettlementCategory(expense.categoryId)) return 0
  if (participantId == null) return 0
  return calculateShares(expense)[participantId] ?? 0
}

export function getTotalGroupSpending(expenses: TotalsExpense[]): number {
  return expenses.reduce(
    (total, expense) =>
      isSettlementCategory(expense.categoryId) ? total : total + expense.amount,
    0,
  )
}

export function getTotalActiveUserPaidFor(
  activeUserId: string | null,
  expenses: TotalsExpense[],
): number {
  if (activeUserId == null) return 0
  const balances = getBalances(
    expenses.filter((e) => !isSettlementCategory(e.categoryId)),
  )
  return balances[activeUserId]?.paid ?? 0
}

export function getTotalActiveUserShare(
  activeUserId: string | null,
  expenses: TotalsExpense[],
): number {
  if (activeUserId == null) return 0
  const balances = getBalances(
    expenses.filter((e) => !isSettlementCategory(e.categoryId)),
  )
  return balances[activeUserId]?.paidFor ?? 0
}

export function serializePaidFor<T extends ParticipantShare>({
  splitMode,
  paidFor,
  currency,
  conversionRate,
}: {
  splitMode: SplitMode
  paidFor: T[]
  amount: number
  currency: Currency
  conversionRate?: number
}): T[] {
  const rate = conversionRate ?? 1
  return paidFor.map((p) => {
    let shares: number
    switch (splitMode) {
      case 'BY_AMOUNT':
      case 'ITEMIZED':
        shares = amountAsMinorUnits(Number(p.shares) * rate, currency)
        break
      case 'BY_PERCENTAGE':
        shares = Math.round(Number(p.shares) * 100)
        break
      case 'BY_SHARES':
        // Display share (e.g. 0.5, 1.1) → fixed units (50, 110). EVENLY
        // is ignored by calculations and is left untouched so inclusion
        // markers don't accidentally become "valid" share weights.
        shares = sharesAsFixedUnits(Number(p.shares))
        break
      default:
        shares = Math.round(Number(p.shares))
    }
    return { ...p, shares }
  })
}

export function serializePaidBy<T extends ParticipantShare>({
  paidBySplitMode,
  paidByList,
  inputCurrency,
}: {
  paidBySplitMode: SplitMode
  paidByList: T[]
  amount: number
  inputCurrency: Currency
  conversionRate?: number
}): T[] {
  // BY_AMOUNT stays in original/input currency; getBalances applies conversionRate at read time
  const mode = paidBySplitMode === 'ITEMIZED' ? 'BY_AMOUNT' : paidBySplitMode

  return paidByList.map((p) => {
    let shares: number
    switch (mode) {
      case 'BY_AMOUNT':
        shares = amountAsMinorUnits(Number(p.shares), inputCurrency)
        break
      case 'BY_PERCENTAGE':
        shares = Math.round(Number(p.shares) * 100)
        break
      case 'BY_SHARES':
        // Display share (e.g. 0.5, 1.1) → fixed units (50, 110). EVENLY
        // inclusion markers are untouched so they remain ignored weights.
        shares = sharesAsFixedUnits(Number(p.shares))
        break
      default:
        shares = Math.round(Number(p.shares))
    }
    return { ...p, shares }
  })
}
