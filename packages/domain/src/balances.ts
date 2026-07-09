import type { ConversionSource } from './conversion'
import type { SplitMode } from './enums'
import {
  addExactAmount,
  convertByRate,
  exactAmountToNumber,
  type ExactAmount,
} from './exact-math'
import { computeExactSharesFromItems } from './itemized-expenses'
import { distributeRemainder } from './remainder-distribution'
import { calculateExactShares } from './totals'

type ParticipantLike = { id: string; name?: string }

type PayerShare = {
  shares: number
  participant: ParticipantLike
}

type BalanceItem = {
  amount: number
  splitMode: SplitMode
  paidFor: Array<{ participant: string; shares: number }>
}

type BalanceItemizedRemainder = {
  splitMode: SplitMode
  paidFor: Array<{ participant: string; shares: number }>
}

export type BalanceExpense = {
  id?: string
  amount: number
  splitMode: SplitMode
  paidBySplitMode: SplitMode
  paidByList: PayerShare[]
  paidFor: PayerShare[]
  originalAmount?: number | null
  originalCurrency?: string | null
  conversionRate?: number | string | null
  conversionSource?: ConversionSource | null
  /** Present on balance-read paths; enables precise ITEMIZED accumulation. */
  items?: BalanceItem[]
  itemizedRemainder?: BalanceItemizedRemainder | null
  [key: string]: unknown
}

export type Balances = Record<
  string,
  { paid: number; paidFor: number; total: number }
>

export type Reimbursement = {
  from: string
  to: string
  amount: number
}

function isCrossCurrency(expense: BalanceExpense): boolean {
  return Boolean(expense.originalCurrency && expense.conversionRate)
}

function addExact(
  target: Record<string, ExactAmount>,
  shares: Record<string, ExactAmount>,
): void {
  for (const [id, value] of Object.entries(shares)) {
    const current = target[id]
    target[id] = current ? addExactAmount(current, value) : value
  }
}

/** For literal modes, give amount−Σshares residual to the primary payer. */
function applyLiteralResidual(
  exact: Record<string, ExactAmount>,
  amount: number,
  payerId: string | undefined,
): Record<string, ExactAmount> {
  if (payerId == null) return exact
  const sum = Object.values(exact).reduce(
    (total, value) => total + exactAmountToNumber(value),
    0,
  )
  const diff = amount - Math.round(sum)
  if (diff === 0) return exact
  const next = { ...exact }
  const current = next[payerId]
  next[payerId] = current
    ? addExactAmount(current, { numerator: BigInt(diff), denominator: 1n })
    : { numerator: BigInt(diff), denominator: 1n }
  return next
}

export function getBalances(expenses: BalanceExpense[]): Balances {
  const globalPaid: Record<string, ExactAmount> = {}
  const globalPaidFor: Record<string, ExactAmount> = {}
  let totalAmount = 0

  for (const expense of expenses) {
    totalAmount += expense.amount
    const crossCurrency = isCrossCurrency(expense)
    const primaryPayerId = expense.paidByList[0]?.participant.id

    // PaidBy side (may be cross-currency)
    const payerBase = crossCurrency
      ? (expense.originalAmount ?? expense.amount)
      : expense.amount
    const paidBySplitMode: SplitMode =
      expense.paidBySplitMode === 'ITEMIZED'
        ? 'BY_AMOUNT'
        : expense.paidBySplitMode

    let exactPaidBy = calculateExactShares({
      amount: payerBase,
      splitMode: paidBySplitMode,
      participants: expense.paidByList.map((p) => ({
        id: p.participant.id,
        shares: Number(p.shares),
      })),
    })

    if (crossCurrency) {
      // Prefer amount/originalAmount so minor-unit scale matches the stored
      // ledger total when currencies have different decimal_digits.
      const originalAmount = expense.originalAmount ?? expense.amount
      const scale =
        originalAmount !== 0
          ? expense.amount / originalAmount
          : Number(expense.conversionRate)
      const converted: Record<string, ExactAmount> = {}
      for (const [id, share] of Object.entries(exactPaidBy)) {
        converted[id] = {
          numerator: BigInt(Math.round(exactAmountToNumber(share) * scale)),
          denominator: 1n,
        }
      }
      exactPaidBy = converted
    } else if (
      paidBySplitMode === 'BY_AMOUNT' ||
      expense.paidBySplitMode === 'ITEMIZED'
    ) {
      // Literal cents: residual vs ledger amount goes to primary payer
      exactPaidBy = applyLiteralResidual(
        exactPaidBy,
        expense.amount,
        primaryPayerId,
      )
    }

    // PaidFor side (always ledger currency)
    let exactPaidFor: Record<string, ExactAmount>

    // ITEMIZED with items: accumulate exact rational shares from items so
    // per-expense remainder tie-breaks don't leak into group totals.
    // Fall back to stored paidFor when items are absent (tests, totals).
    if (
      expense.splitMode === 'ITEMIZED' &&
      !crossCurrency &&
      Array.isArray(expense.items) &&
      expense.items.length > 0
    ) {
      const memberIds = [
        ...new Set([
          ...expense.paidFor.map((p) => p.participant.id),
          ...expense.paidByList.map((p) => p.participant.id),
          ...expense.items.flatMap((i) => i.paidFor.map((p) => p.participant)),
          ...(expense.itemizedRemainder?.paidFor.map((p) => p.participant) ??
            []),
        ]),
      ]
      exactPaidFor = computeExactSharesFromItems(
        expense.items,
        memberIds,
        expense.amount,
        expense.itemizedRemainder ?? undefined,
      )
    } else {
      const paidForSplitMode: SplitMode =
        expense.splitMode === 'ITEMIZED' && crossCurrency
          ? 'BY_SHARES'
          : expense.splitMode

      let paidForBase = expense.amount
      if (
        crossCurrency &&
        expense.conversionRate != null &&
        expense.splitMode === 'BY_AMOUNT'
      ) {
        paidForBase = expense.originalAmount ?? expense.amount
      }

      exactPaidFor = calculateExactShares({
        amount: paidForBase,
        splitMode: paidForSplitMode,
        participants: expense.paidFor.map((p) => ({
          id: p.participant.id,
          shares: Number(p.shares),
        })),
      })

      if (
        crossCurrency &&
        expense.conversionRate != null &&
        expense.splitMode === 'BY_AMOUNT'
      ) {
        const originalAmount = expense.originalAmount ?? expense.amount
        const scale =
          originalAmount !== 0
            ? expense.amount / originalAmount
            : Number(expense.conversionRate)
        const converted: Record<string, ExactAmount> = {}
        for (const [id, share] of Object.entries(exactPaidFor)) {
          converted[id] = convertByRate(share, scale)
        }
        exactPaidFor = converted
      } else if (
        (expense.splitMode === 'BY_AMOUNT' ||
          (expense.splitMode === 'ITEMIZED' && !crossCurrency)) &&
        !crossCurrency
      ) {
        exactPaidFor = applyLiteralResidual(
          exactPaidFor,
          expense.amount,
          primaryPayerId,
        )
      }
    }

    addExact(globalPaid, exactPaidBy)
    addExact(globalPaidFor, exactPaidFor)
  }

  const paid = distributeRemainder(globalPaid, totalAmount, { seed: 0 })
  const paidFor = distributeRemainder(globalPaidFor, totalAmount, { seed: 0 })

  const balances: Balances = {}
  const ids = new Set([
    ...Object.keys(globalPaid),
    ...Object.keys(globalPaidFor),
    ...Object.keys(paid),
    ...Object.keys(paidFor),
  ])

  for (const id of ids) {
    const p = (paid[id] ?? 0) + 0
    const pf = (paidFor[id] ?? 0) + 0
    balances[id] = { paid: p, paidFor: pf, total: p - pf + 0 }
  }

  return balances
}

export function getPublicBalances(reimbursements: Reimbursement[]): Balances {
  const balances: Balances = {}
  reimbursements.forEach((reimbursement) => {
    if (!balances[reimbursement.from])
      balances[reimbursement.from] = { paid: 0, paidFor: 0, total: 0 }

    if (!balances[reimbursement.to])
      balances[reimbursement.to] = { paid: 0, paidFor: 0, total: 0 }

    balances[reimbursement.from].paidFor += reimbursement.amount
    balances[reimbursement.from].total -= reimbursement.amount

    balances[reimbursement.to].paid += reimbursement.amount
    balances[reimbursement.to].total += reimbursement.amount
  })
  return balances
}

/**
 * A comparator that is stable across reimbursements.
 * This ensures that a participant executing a suggested reimbursement
 * does not result in completely new repayment suggestions.
 */
function compareBalancesForReimbursements(
  b1: { participantId: string; total: number },
  b2: { participantId: string; total: number },
): number {
  // positive balances come before negative balances
  if (b1.total > 0 && 0 > b2.total) {
    return -1
  } else if (b2.total > 0 && 0 > b1.total) {
    return 1
  }
  // if signs match, sort based on userid
  return b1.participantId < b2.participantId ? -1 : 1
}

export function getSuggestedReimbursements(
  balances: Balances,
): Reimbursement[] {
  const balancesArray = Object.entries(balances)
    .map(([participantId, { total }]) => ({ participantId, total }))
    .filter((b) => b.total !== 0)
  balancesArray.sort(compareBalancesForReimbursements)
  const reimbursements: Reimbursement[] = []
  while (balancesArray.length > 1) {
    const first = balancesArray[0]
    const last = balancesArray[balancesArray.length - 1]
    const amount = first.total + last.total
    if (first.total > -last.total) {
      reimbursements.push({
        from: last.participantId,
        to: first.participantId,
        amount: -last.total,
      })
      first.total = amount
      balancesArray.pop()
    } else {
      reimbursements.push({
        from: last.participantId,
        to: first.participantId,
        amount: first.total,
      })
      last.total = amount
      balancesArray.shift()
    }
  }
  return reimbursements.filter(({ amount }) => Math.round(amount) + 0 !== 0)
}
