import { Cause, Effect, Exit, Option } from 'effect'

import { getCurrency } from '@spliit/domain'
import { parseSettleUpCsv } from '@spliit/domain/import'
import { parseTricountCsvSingle } from '@spliit/domain/import'

// Synthetic shared scenarios. Every visible amount and import count derives
// here; both fixtures are verified through the real domain parsers below.

// --- Tricount: Alpine ski trip, 4 people, EUR --------------------------------
export const skiPeople = [
  { id: 'alex', name: 'Alex' },
  { id: 'julia', name: 'Julia' },
  { id: 'sam', name: 'Sam' },
  { id: 'morgan', name: 'Morgan' },
]

const TRICOUNT_HEADER =
  'Title;Amount;Currency;Exchange rate;Amount in default currency (EUR);Transaction type;Category;Paid by;Date & time;Paid by Alex;Impacted to Alex;Paid by Julia;Impacted to Julia;Paid by Sam;Impacted to Sam;Paid by Morgan;Impacted to Morgan'

const tricountRow = (cells: string[]) => cells.join(';')

const tricountCsv = [
  TRICOUNT_HEADER,
  // Chalet: Alex advances 480 EUR, split four ways.
  tricountRow([
    'Chalet',
    '-480.00',
    'EUR',
    '1',
    '480.00',
    'NORMAL',
    'Accommodation',
    'Alex',
    '2026-01-10 18:00:00',
    '480',
    '120',
    '0',
    '120',
    '0',
    '120',
    '0',
    '120',
  ]),
  // Lift passes: Julia advances 320 EUR, split four ways.
  tricountRow([
    'Lift passes',
    '-320.00',
    'EUR',
    '1',
    '320.00',
    'NORMAL',
    'Sport',
    'Julia',
    '2026-01-11 09:00:00',
    '0',
    '80',
    '320',
    '80',
    '0',
    '80',
    '0',
    '80',
  ]),
  // Fondue night: Sam advances 96 EUR, split four ways.
  tricountRow([
    'Fondue night',
    '-96.00',
    'EUR',
    '1',
    '96.00',
    'NORMAL',
    'Restaurant',
    'Sam',
    '2026-01-12 20:00:00',
    '0',
    '24',
    '0',
    '24',
    '96',
    '24',
    '0',
    '24',
  ]),
  // Repayment: Morgan settles 120 EUR toward Alex.
  tricountRow([
    'repayment Alex',
    '-120.00',
    'EUR',
    '1',
    '120.00',
    'BALANCE',
    'Transfer',
    'Morgan',
    '2026-01-13 10:00:00',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '120',
    '120',
  ]),
  'tricount Ski trip - Exported on 2026-01-14',
].join('\n')

function runEffect<T>(effect: Effect.Effect<T, unknown>, label: string): T {
  const exit = Effect.runSyncExit(effect)
  if (Exit.isFailure(exit)) {
    const failure = Cause.findErrorOption(exit.cause)
    const message =
      Option.isSome(failure) &&
      failure.value &&
      typeof failure.value === 'object' &&
      'message' in failure.value
        ? String(failure.value.message)
        : 'unknown import error'
    throw new Error(`Promo import fixture (${label}): ${message}`)
  }
  return exit.value
}

const tricountSource = runEffect(
  parseTricountCsvSingle(tricountCsv),
  'tricount',
)
export const skiSource = { ...tricountSource, name: 'Ski trip' }
export const skiParticipants = skiSource.participants.map((person, index) => ({
  key: person.sourceId,
  source: person,
  mode: 'LINK_ACCOUNT' as const,
  linkedAccountId: skiPeople[index]!.id,
}))

// --- Settle Up: flatshare, 3 people, EUR -------------------------------------
export const flatPeople = [
  { id: 'alex', name: 'Alex' },
  { id: 'jamie', name: 'Jamie' },
  { id: 'sam', name: 'Sam' },
]

const SETTLEUP_HEADER =
  '"Who paid","Amount","Currency","For whom","Split amounts","Purpose","Category","Date & time","Timezone","Exchange rate","Converted amount","Type","Receipt"'

const settleUpRow = (cells: string[]) =>
  cells.map((cell) => `"${cell}"`).join(',')

const settleUpCsv = [
  SETTLEUP_HEADER,
  // Rent: Alex pays 900 EUR for all three.
  settleUpRow([
    'Alex',
    '900',
    'EUR',
    'Alex;Jamie;Sam',
    '300;300;300',
    'March rent',
    'Rent',
    '2026-03-01 09:00:00',
    '+01:00',
    '',
    '900',
    'expense',
    '',
  ]),
  // Groceries: Jamie pays 75.50 EUR for Alex + Jamie.
  settleUpRow([
    'Jamie',
    '75.50',
    'EUR',
    'Alex;Jamie',
    '37.75;37.75',
    'Weekly groceries',
    'Groceries',
    '2026-03-04 18:30:00',
    '+01:00',
    '',
    '75.50',
    'expense',
    '',
  ]),
  // Internet: Sam pays 39.99 EUR for all three.
  settleUpRow([
    'Sam',
    '39.99',
    'EUR',
    'Alex;Jamie;Sam',
    '13.33;13.33;13.33',
    'Internet bill',
    'Utilities',
    '2026-03-05 12:00:00',
    '+01:00',
    '',
    '39.99',
    'expense',
    '',
  ]),
  // Transfer: Jamie sends Alex 200 EUR (settlement).
  settleUpRow([
    'Jamie',
    '200',
    'EUR',
    'Alex',
    '200',
    'Settling up',
    '',
    '2026-03-06 20:00:00',
    '+01:00',
    '',
    '200',
    'transfer',
    '',
  ]),
].join('\n')

const settleUpSource = runEffect(parseSettleUpCsv(settleUpCsv), 'settleup')
export const flatSource = { ...settleUpSource, name: 'Flatshare' }
export const flatParticipants = flatSource.participants.map(
  (person, index) => ({
    key: person.sourceId,
    source: person,
    mode: 'LINK_ACCOUNT' as const,
    linkedAccountId: flatPeople[index]!.id,
  }),
)

// --- Shared -----------------------------------------------------------------
export const currency = getCurrency('EUR')!
export const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' }).format(
    cents / 100,
  )
export const tricountExpenseCount = skiSource.expenses.length
export const settleUpExpenseCount = flatSource.expenses.length
