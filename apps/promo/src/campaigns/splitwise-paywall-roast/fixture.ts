import { Cause, Effect, Exit, Option } from 'effect'

import { getCurrency } from '@spliit/domain'
import { parseSplitwiseCsv } from '@spliit/domain/import'

// Synthetic shared scenario. Every visible amount and import count derives here.
export const people = [
  { id: 'alex', name: 'Alex' },
  { id: 'jamie', name: 'Jamie' },
  { id: 'sam', name: 'Sam' },
]
export const expenses = [
  { title: 'Apartment', amount: 9000 },
  { title: 'Coffee', amount: 1200 },
  { title: 'Taxi', amount: 1800 },
  { title: 'Groceries', amount: 600 },
  { title: 'Pizza', amount: 2400 },
]
export const pizza = expenses[4]
export const currency = getCurrency('USD')!
export const total = expenses.reduce((sum, expense) => sum + expense.amount, 0)
export const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    cents / 100,
  )
export const groupBalances = people.map((person, index) => ({
  ...person,
  members: [person],
  total: index === 0 ? total - total / people.length : -total / people.length,
}))
export const friendBalances = people.slice(0, 2).map((person, index) => ({
  ...person,
  members: [person],
  total: ((index === 0 ? 1 : -1) * pizza.amount) / 2,
}))
export const importPeople = [
  ...people,
  { id: 'morgan', name: 'Morgan' },
  { id: 'taylor', name: 'Taylor' },
]
export const importExpenses = [
  ...expenses,
  { title: 'Hotel extension', amount: 30000 },
  { title: 'Train tickets', amount: 18000 },
  { title: 'Group dinner', amount: 15000 },
  { title: 'Boat trip', amount: 12000 },
  { title: 'Museum passes', amount: 10000 },
  { title: 'Airport transfers', amount: 9000 },
  { title: 'Tapas night', amount: 8000 },
  { title: 'Bike rentals', amount: 7500 },
  { title: 'Beach lunch', amount: 6500 },
  { title: 'Market shopping', amount: 5500 },
  { title: 'Breakfast', amount: 4500 },
  { title: 'Late-night snacks', amount: 3500 },
  { title: 'Metro passes', amount: 2500 },
  { title: 'Ice cream', amount: 2000 },
  { title: 'Bottled water', amount: 1000 },
]
export const importTotal = importExpenses.reduce(
  (sum, expense) => sum + expense.amount,
  0,
)
export const splitwiseCsv = [
  'Date,Description,Category,Cost,Currency,Alex,Jamie,Sam,Morgan,Taylor',
  ...importExpenses.map((expense) => {
    const share = expense.amount / importPeople.length
    return [
      '2026-10-10',
      expense.title,
      'General',
      (expense.amount / 100).toFixed(2),
      'USD',
      ((expense.amount - share) / 100).toFixed(2),
      (-share / 100).toFixed(2),
      (-share / 100).toFixed(2),
      (-share / 100).toFixed(2),
      (-share / 100).toFixed(2),
    ].join(',')
  }),
].join('\n')
const exit = Effect.runSyncExit(parseSplitwiseCsv(splitwiseCsv))
if (Exit.isFailure(exit)) {
  const failure = Cause.findErrorOption(exit.cause)
  const message =
    Option.isSome(failure) &&
    failure.value &&
    typeof failure.value === 'object' &&
    'message' in failure.value
      ? String(failure.value.message)
      : 'unknown import error'
  throw new Error(`Promo import fixture: ${message}`)
}
const source = exit.value
export const importSource = { ...source, name: 'Barcelona trip' }
export const importParticipants = importSource.participants.map(
  (person, index) => ({
    key: person.sourceId,
    source: person,
    mode: 'LINK_ACCOUNT' as const,
    linkedAccountId: importPeople[index].id,
  }),
)
