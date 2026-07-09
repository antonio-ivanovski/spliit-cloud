import Decimal from 'decimal.js'
import { getBalances } from './balances'
import type { Currency } from './currency'
import type { SplitMode } from './enums'
import { amountAsMinorUnits, expenseIdSeed } from './utils'

export type TotalsExpense = {
  id?: string
  amount: number
  splitMode: SplitMode
  paidBySplitMode: SplitMode
  isReimbursement: boolean
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
  expenseDate?: Date | string | number | null
  [key: string]: unknown
}

export type SplitInput = {
  amount: number
  splitMode: SplitMode
  participants: Array<{ id: string; shares: number }>
}

export type TieBreakStrategy =
  'EXPENSE_ID_SEEDED' | 'PARTICIPANT_ID_DESC' | 'ROUND_ROBIN' | 'RANDOM_SEEDED'

export type DistributeRemainderOpts = {
  seed?: number
  payerId?: string
  strategy?: TieBreakStrategy
}

type ParticipantShare = {
  shares: number
}

function isCrossCurrency(
  expense: Pick<TotalsExpense, 'originalCurrency' | 'conversionRate'>,
): boolean {
  return Boolean(expense.originalCurrency && expense.conversionRate)
}

/** Exact (non-truncated) per-participant Decimal shares for all split modes. */
export function calculateExactShares(
  input: SplitInput,
): Record<string, Decimal> {
  const { amount, splitMode, participants } = input
  if (participants.length === 0) return {}

  const result: Record<string, Decimal> = {}
  if (amount === 0) {
    for (const p of participants) result[p.id] = new Decimal(0)
    return result
  }

  const amountD = new Decimal(amount)

  switch (splitMode) {
    case 'EVENLY': {
      const share = amountD.div(participants.length)
      for (const p of participants) {
        result[p.id] = (result[p.id] ?? new Decimal(0)).plus(share)
      }
      break
    }
    case 'BY_SHARES': {
      const totalShares = participants.reduce((sum, p) => sum + p.shares, 0)
      if (totalShares === 0) {
        for (const p of participants) {
          result[p.id] = result[p.id] ?? new Decimal(0)
        }
        break
      }
      const totalD = new Decimal(totalShares)
      for (const p of participants) {
        result[p.id] = (result[p.id] ?? new Decimal(0)).plus(
          amountD.mul(p.shares).div(totalD),
        )
      }
      break
    }
    case 'BY_PERCENTAGE': {
      for (const p of participants) {
        result[p.id] = (result[p.id] ?? new Decimal(0)).plus(
          amountD.mul(p.shares).div(10000),
        )
      }
      break
    }
    case 'BY_AMOUNT':
    case 'ITEMIZED': {
      for (const p of participants) {
        result[p.id] = (result[p.id] ?? new Decimal(0)).plus(p.shares)
      }
      break
    }
  }

  return result
}

/**
 * Truncate toward zero and distribute leftover cents by descending fractional
 * part; EXPENSE_ID_SEEDED rotates within equal-frac groups via seed.
 */
export function distributeRemainder(
  exactShares: Record<string, Decimal>,
  amount: number,
  opts?: DistributeRemainderOpts,
): Record<string, number> {
  const ids = Object.keys(exactShares)
  if (ids.length === 0) {
    if (opts?.payerId != null && amount !== 0) {
      return { [opts.payerId]: amount }
    }
    return {}
  }

  const result: Record<string, number> = {}
  type Entry = { id: string; frac: Decimal }
  const entries: Entry[] = []

  for (const id of ids) {
    const exact = exactShares[id]
    const truncated = exact.trunc().toNumber()
    result[id] = truncated
    entries.push({ id, frac: exact.minus(truncated).abs() })
  }

  const sumTruncated = Object.values(result).reduce((sum, n) => sum + n, 0)
  const diff = amount - sumTruncated
  if (diff === 0) return result

  if (opts?.payerId != null) {
    result[opts.payerId] = (result[opts.payerId] ?? 0) + diff
    return result
  }

  const strategy = opts?.strategy ?? 'EXPENSE_ID_SEEDED'
  const seed = opts?.seed ?? 0
  const order = orderForRemainder(entries, seed, strategy)
  const step = diff > 0 ? 1 : -1
  let remaining = Math.abs(diff)

  let i = 0
  while (remaining > 0 && order.length > 0) {
    const id = order[i % order.length]
    result[id] = (result[id] ?? 0) + step
    remaining -= 1
    i += 1
  }

  return result
}

/** Build participant order: frac desc, id asc; seed rotates within equal-frac ties. */
function orderForRemainder(
  entries: Array<{ id: string; frac: Decimal }>,
  seed: number,
  strategy: TieBreakStrategy,
): string[] {
  const sorted = [...entries].sort((a, b) => {
    const fracCmp = b.frac.cmp(a.frac)
    if (fracCmp !== 0) return fracCmp
    if (strategy === 'PARTICIPANT_ID_DESC') {
      return a.id > b.id ? -1 : a.id < b.id ? 1 : 0
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  if (strategy !== 'EXPENSE_ID_SEEDED' && strategy !== 'RANDOM_SEEDED') {
    return sorted.map((e) => e.id)
  }

  // Rotate within consecutive equal-frac groups so largest remainder is preserved
  // while seed fairly breaks ties across expenses.
  const ordered: string[] = []
  let i = 0
  while (i < sorted.length) {
    let j = i + 1
    while (j < sorted.length && sorted[j].frac.equals(sorted[i].frac)) j += 1
    const group = sorted.slice(i, j)
    if (group.length > 1) {
      const offset = ((seed % group.length) + group.length) % group.length
      for (let k = 0; k < group.length; k++) {
        ordered.push(group[(k + offset) % group.length].id)
      }
    } else {
      ordered.push(group[0].id)
    }
    i = j
  }
  return ordered
}

type SharesExpense = Pick<
  TotalsExpense,
  | 'amount'
  | 'splitMode'
  | 'paidFor'
  | 'isReimbursement'
  | 'originalAmount'
  | 'originalCurrency'
  | 'conversionRate'
> & {
  id?: string | null
  paidByList?: TotalsExpense['paidByList']
}

/** Per-expense integer paidFor shares; sum === expense.amount. */
export function calculateShares(
  expense: SharesExpense,
): Record<string, number> {
  const paidFor = expense.paidFor
  if (paidFor.length === 0) return {}

  const crossCurrency = isCrossCurrency(expense)
  // ITEMIZED cross-currency shares are original-currency weights against ledger amount
  const splitMode: SplitMode =
    expense.splitMode === 'ITEMIZED' && crossCurrency
      ? 'BY_SHARES'
      : expense.splitMode

  const exact = calculateExactShares({
    amount: expense.amount,
    splitMode,
    participants: paidFor.map((p) => ({
      id: p.participant.id,
      shares: Number(p.shares),
    })),
  })

  const seed = expenseIdSeed(expense.id)
  // payerId only for same-currency literal cents; FX conversion residual
  // must use fractional-part distribution (matches getBalances).
  const payerId =
    !crossCurrency &&
    (expense.splitMode === 'BY_AMOUNT' || expense.splitMode === 'ITEMIZED')
      ? expense.paidByList?.[0]?.participant.id
      : undefined

  return distributeRemainder(exact, expense.amount, { seed, payerId })
}

type PaidBySharesExpense = Pick<
  TotalsExpense,
  | 'amount'
  | 'paidByList'
  | 'paidBySplitMode'
  | 'isReimbursement'
  | 'originalAmount'
  | 'originalCurrency'
  | 'conversionRate'
> & {
  id?: string | null
}

/** Per-expense integer paidBy shares in ledger currency; sum === expense.amount. */
export function calculatePaidByShares(
  expense: PaidBySharesExpense,
): Record<string, number> {
  const paidBys = expense.paidByList
  if (paidBys.length === 0) return {}

  const crossCurrency = isCrossCurrency(expense)
  const payerBase = crossCurrency
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

  if (crossCurrency) {
    const rate = new Decimal(expense.conversionRate as number | string)
    const converted: Record<string, Decimal> = {}
    for (const [id, share] of Object.entries(exact)) {
      converted[id] = share.mul(rate)
    }
    exact = converted
  }

  const seed = expenseIdSeed(expense.id)
  // payerId only for same-currency literal cents; FX conversion residual
  // must use fractional-part distribution (matches getBalances).
  const payerId =
    !crossCurrency &&
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
  if (expense.isReimbursement) return 0
  if (participantId == null) return 0
  return calculatePaidByShares(expense)[participantId] ?? 0
}

export function calculateShare(
  participantId: string | null,
  expense: SharesExpense,
): number {
  if (expense.isReimbursement) return 0
  if (participantId == null) return 0
  return calculateShares(expense)[participantId] ?? 0
}

export function getTotalGroupSpending(expenses: TotalsExpense[]): number {
  return expenses.reduce(
    (total, expense) =>
      expense.isReimbursement ? total : total + expense.amount,
    0,
  )
}

export function getTotalActiveUserPaidFor(
  activeUserId: string | null,
  expenses: TotalsExpense[],
): number {
  if (activeUserId == null) return 0
  const balances = getBalances(expenses.filter((e) => !e.isReimbursement))
  return balances[activeUserId]?.paid ?? 0
}

export function getTotalActiveUserShare(
  activeUserId: string | null,
  expenses: TotalsExpense[],
): number {
  if (activeUserId == null) return 0
  const balances = getBalances(expenses.filter((e) => !e.isReimbursement))
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
      default:
        shares = Math.round(Number(p.shares))
    }
    return { ...p, shares }
  })
}
