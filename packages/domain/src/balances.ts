import type { ConversionSource } from './conversion'
import type { RemainderAllocationMode, SplitMode } from './enums'
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
  allocationMode?: RemainderAllocationMode
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

export type SuggestedSettlement = {
  from: string
  to: string
  amount: number
}

export type CurrencyBalanceSummary = {
  currencyCode: string
  balances: Balances
  suggestedSettlements: SuggestedSettlement[]
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

type ExpenseExactShares = {
  amount: number
  paidBy: Record<string, ExactAmount>
  paidFor: Record<string, ExactAmount>
}

/**
 * Normalize one expense to exact per-participant paid / paid-for amounts in the
 * ledger currency. Shared by getBalances() and getDirectSettlements() so both
 * views agree on every participant's net total.
 */
function getLedgerExpenseShares(expense: BalanceExpense): ExpenseExactShares {
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
        ...(expense.itemizedRemainder?.paidFor.map((p) => p.participant) ?? []),
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

  return { amount: expense.amount, paidBy: exactPaidBy, paidFor: exactPaidFor }
}

export function getBalances(expenses: BalanceExpense[]): Balances {
  const globalPaid: Record<string, ExactAmount> = {}
  const globalPaidFor: Record<string, ExactAmount> = {}
  let totalAmount = 0

  for (const expense of expenses) {
    const { amount, paidBy, paidFor } = getLedgerExpenseShares(expense)
    totalAmount += amount
    addExact(globalPaid, paidBy)
    addExact(globalPaidFor, paidFor)
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

/**
 * Normalize one expense to exact per-participant amounts in the currency it was
 * entered in (the ledger currency for same-currency expenses).
 */
function getNativeExpenseShares(
  expense: BalanceExpense,
  groupCurrencyCode: string | null | undefined,
): ExpenseExactShares & { currencyCode: string } {
  const crossCurrency = isCrossCurrency(expense)
  const currencyCode = crossCurrency
    ? expense.originalCurrency!
    : (groupCurrencyCode ?? '')
  const amount = crossCurrency
    ? (expense.originalAmount ?? expense.amount)
    : expense.amount
  const primaryPayerId = expense.paidByList[0]?.participant.id

  const paidBySplitMode: SplitMode =
    expense.paidBySplitMode === 'ITEMIZED'
      ? 'BY_AMOUNT'
      : expense.paidBySplitMode
  let exactPaidBy = calculateExactShares({
    amount,
    splitMode: paidBySplitMode,
    participants: expense.paidByList.map((payer) => ({
      id: payer.participant.id,
      shares: Number(payer.shares),
    })),
  })
  if (
    paidBySplitMode === 'BY_AMOUNT' ||
    expense.paidBySplitMode === 'ITEMIZED'
  ) {
    exactPaidBy = applyLiteralResidual(exactPaidBy, amount, primaryPayerId)
  }

  let exactPaidFor: Record<string, ExactAmount>
  if (
    expense.splitMode === 'ITEMIZED' &&
    Array.isArray(expense.items) &&
    expense.items.length > 0
  ) {
    const memberIds = [
      ...new Set([
        ...expense.paidFor.map((participant) => participant.participant.id),
        ...expense.paidByList.map((payer) => payer.participant.id),
        ...expense.items.flatMap((item) =>
          item.paidFor.map((participant) => participant.participant),
        ),
        ...(expense.itemizedRemainder?.paidFor.map(
          (participant) => participant.participant,
        ) ?? []),
      ]),
    ]
    exactPaidFor = computeExactSharesFromItems(
      expense.items,
      memberIds,
      amount,
      expense.itemizedRemainder ?? undefined,
    )
  } else {
    const splitMode =
      expense.splitMode === 'ITEMIZED' ? 'BY_SHARES' : expense.splitMode
    exactPaidFor = calculateExactShares({
      amount,
      splitMode,
      participants: expense.paidFor.map((participant) => ({
        id: participant.participant.id,
        shares: Number(participant.shares),
      })),
    })
    if (expense.splitMode === 'BY_AMOUNT')
      exactPaidFor = applyLiteralResidual(exactPaidFor, amount, primaryPayerId)
  }

  return { currencyCode, amount, paidBy: exactPaidBy, paidFor: exactPaidFor }
}

/**
 * Compute balances in each expense's entered currency. These are deliberately
 * separate from getBalances(), whose values are normalized to the ledger.
 */
export function getBalancesByCurrency(
  expenses: BalanceExpense[],
  groupCurrencyCode: string | null | undefined,
): Record<string, Balances> {
  const paidByCurrency: Record<string, Record<string, ExactAmount>> = {}
  const paidForByCurrency: Record<string, Record<string, ExactAmount>> = {}
  const totalsByCurrency: Record<string, number> = {}

  for (const expense of expenses) {
    const {
      currencyCode,
      amount,
      paidBy: exactPaidBy,
      paidFor: exactPaidFor,
    } = getNativeExpenseShares(expense, groupCurrencyCode)
    const paid = (paidByCurrency[currencyCode] ??= {})
    const paidFor = (paidForByCurrency[currencyCode] ??= {})
    totalsByCurrency[currencyCode] =
      (totalsByCurrency[currencyCode] ?? 0) + amount

    addExact(paid, exactPaidBy)
    addExact(paidFor, exactPaidFor)
  }

  return Object.fromEntries(
    Object.keys(totalsByCurrency).map((currencyCode) => {
      const paid = distributeRemainder(
        paidByCurrency[currencyCode] ?? {},
        totalsByCurrency[currencyCode],
        { seed: 0 },
      )
      const paidFor = distributeRemainder(
        paidForByCurrency[currencyCode] ?? {},
        totalsByCurrency[currencyCode],
        { seed: 0 },
      )
      const balances: Balances = {}
      const ids = new Set([...Object.keys(paid), ...Object.keys(paidFor)])
      for (const id of ids) {
        const participantPaid = (paid[id] ?? 0) + 0
        const participantPaidFor = (paidFor[id] ?? 0) + 0
        balances[id] = {
          paid: participantPaid,
          paidFor: participantPaidFor,
          total: participantPaid - participantPaidFor + 0,
        }
      }
      return [currencyCode, balances]
    }),
  )
}

export function getCurrencyBalanceSummaries(
  expenses: BalanceExpense[],
  groupCurrencyCode: string | null | undefined,
): CurrencyBalanceSummary[] {
  return Object.entries(getBalancesByCurrency(expenses, groupCurrencyCode)).map(
    ([currencyCode, balances]) => {
      const suggestedSettlements = getSuggestedSettlements(balances)
      return {
        currencyCode,
        balances: getPublicBalances(suggestedSettlements),
        suggestedSettlements,
      }
    },
  )
}

export function getPublicBalances(
  suggestedSettlements: SuggestedSettlement[],
): Balances {
  const balances: Balances = {}
  suggestedSettlements.forEach((settlement) => {
    if (!balances[settlement.from])
      balances[settlement.from] = { paid: 0, paidFor: 0, total: 0 }

    if (!balances[settlement.to])
      balances[settlement.to] = { paid: 0, paidFor: 0, total: 0 }

    balances[settlement.from].paidFor += settlement.amount
    balances[settlement.from].total -= settlement.amount

    balances[settlement.to].paid += settlement.amount
    balances[settlement.to].total += settlement.amount
  })
  return balances
}

/**
 * A comparator that is stable across suggested settlements. This ensures that a
 * participant executing a suggested settlement does not result in completely
 * new repayment suggestions.
 */
function compareBalancesForSettlements(
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

export function getSuggestedSettlements(
  balances: Balances,
): SuggestedSettlement[] {
  const balancesArray = Object.entries(balances)
    .map(([participantId, { total }]) => ({ participantId, total }))
    .filter((b) => b.total !== 0)
  balancesArray.sort(compareBalancesForSettlements)
  const suggestedSettlements: SuggestedSettlement[] = []
  while (balancesArray.length > 1) {
    const first = balancesArray[0]
    const last = balancesArray[balancesArray.length - 1]
    const amount = first.total + last.total
    if (first.total > -last.total) {
      suggestedSettlements.push({
        from: last.participantId,
        to: first.participantId,
        amount: -last.total,
      })
      first.total = amount
      balancesArray.pop()
    } else {
      suggestedSettlements.push({
        from: last.participantId,
        to: first.participantId,
        amount: first.total,
      })
      last.total = amount
      balancesArray.shift()
    }
  }
  return suggestedSettlements.filter(
    ({ amount }) => Math.round(amount) + 0 !== 0,
  )
}

export type DirectCurrencySettlements = {
  currencyCode: string
  directSettlements: SuggestedSettlement[]
}

/** Unordered pair key; the stored amount is what `lo` owes `hi` (signed). */
function pairKey(a: string, b: string): [key: string, sign: 1 | -1] {
  return a < b ? [`${a}\u0000${b}`, 1] : [`${b}\u0000${a}`, -1]
}

function splitPairKey(key: string): [lo: string, hi: string] {
  const [lo, hi] = key.split('\u0000')
  return [lo, hi]
}

/**
 * Accumulate who-owes-whom for one normalized expense: each participant's
 * paid-for share is owed to the payers in proportion to what each paid.
 */
function addDirectDebts(
  pairs: Map<string, number>,
  { paidBy, paidFor }: Pick<ExpenseExactShares, 'paidBy' | 'paidFor'>,
): void {
  const payers = Object.entries(paidBy).map(
    ([id, value]) => [id, exactAmountToNumber(value)] as const,
  )
  const totalPaid = payers.reduce((sum, [, value]) => sum + value, 0)
  if (totalPaid === 0) return

  for (const [debtorId, share] of Object.entries(paidFor)) {
    const owed = exactAmountToNumber(share)
    if (owed === 0) continue
    for (const [payerId, paid] of payers) {
      if (payerId === debtorId || paid === 0) continue
      const [key, sign] = pairKey(debtorId, payerId)
      pairs.set(key, (pairs.get(key) ?? 0) + (sign * owed * paid) / totalPaid)
    }
  }
}

/**
 * Round pairwise debts to whole minor units, then push the rounding residual
 * onto pairs so each participant's net equals `balances[id].total` exactly.
 */
function reconcileDirectDebts(
  pairs: Map<string, number>,
  balances: Balances,
): SuggestedSettlement[] {
  const rounded = new Map<string, number>()
  const net = new Map<string, number>()
  const addNet = (id: string, amount: number) =>
    net.set(id, (net.get(id) ?? 0) + amount)
  for (const [key, value] of pairs) {
    const amount = Math.round(value)
    if (amount === 0) continue
    const [lo, hi] = splitPairKey(key)
    rounded.set(key, amount)
    addNet(hi, amount)
    addNet(lo, -amount)
  }

  const residuals = [...new Set([...net.keys(), ...Object.keys(balances)])]
    .sort()
    .map((id) => ({
      id,
      residual: (balances[id]?.total ?? 0) - (net.get(id) ?? 0),
    }))
  const debtors = residuals.filter((r) => r.residual < 0)
  const creditors = residuals.filter((r) => r.residual > 0)

  // Prefer nudging pairs that already carry a debt, so rounding never
  // introduces a new relationship unless it has to.
  for (const preferExisting of [true, false]) {
    for (const debtor of debtors) {
      for (const creditor of creditors) {
        if (debtor.residual === 0) break
        if (creditor.residual === 0) continue
        const [key, sign] = pairKey(debtor.id, creditor.id)
        if (preferExisting && !rounded.has(key)) continue
        const amount = Math.min(-debtor.residual, creditor.residual)
        rounded.set(key, (rounded.get(key) ?? 0) + sign * amount)
        debtor.residual += amount
        creditor.residual -= amount
      }
    }
  }

  const settlements: SuggestedSettlement[] = []
  for (const [key, amount] of rounded) {
    if (amount === 0) continue
    const [lo, hi] = splitPairKey(key)
    settlements.push(
      amount > 0
        ? { from: lo, to: hi, amount }
        : { from: hi, to: lo, amount: -amount },
    )
  }
  return settlements.sort(
    (a, b) =>
      (a.from < b.from ? -1 : a.from > b.from ? 1 : 0) ||
      (a.to < b.to ? -1 : a.to > b.to ? 1 : 0),
  )
}

/**
 * Un-simplified ("direct") settlements: the net debt between every pair of
 * participants who actually shared an expense. Unlike
 * getSuggestedSettlements(), nobody is asked to pay someone they never shared a
 * cost with. Multi-payer expenses allocate each share proportionally to what
 * each payer paid; settlements and reimbursements are ordinary expenses and
 * reduce the matching pair. Amounts are in the ledger currency and each
 * participant's net equals getBalances()[id].total.
 */
export function getDirectSettlements(
  expenses: BalanceExpense[],
  balances: Balances = getBalances(expenses),
): SuggestedSettlement[] {
  const pairs = new Map<string, number>()
  for (const expense of expenses) {
    addDirectDebts(pairs, getLedgerExpenseShares(expense))
  }
  return reconcileDirectDebts(pairs, balances)
}

/**
 * Direct settlements per entered currency, matching the net balances of
 * getCurrencyBalanceSummaries().
 */
export function getDirectSettlementsByCurrency(
  expenses: BalanceExpense[],
  groupCurrencyCode: string | null | undefined,
): DirectCurrencySettlements[] {
  const pairsByCurrency = new Map<string, Map<string, number>>()
  for (const expense of expenses) {
    const shares = getNativeExpenseShares(expense, groupCurrencyCode)
    let pairs = pairsByCurrency.get(shares.currencyCode)
    if (!pairs) {
      pairs = new Map()
      pairsByCurrency.set(shares.currencyCode, pairs)
    }
    addDirectDebts(pairs, shares)
  }
  return Object.entries(getBalancesByCurrency(expenses, groupCurrencyCode)).map(
    ([currencyCode, balances]) => ({
      currencyCode,
      directSettlements: reconcileDirectDebts(
        pairsByCurrency.get(currencyCode) ?? new Map(),
        balances,
      ),
    }),
  )
}
