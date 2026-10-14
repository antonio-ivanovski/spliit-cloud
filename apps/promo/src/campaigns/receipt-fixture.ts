/** Fictional demonstration data. All amounts are integer USD cents. */
const items = [
  { title: 'Whole milk', amount: 420 },
  { title: 'Coffee beans', amount: 1250 },
  { title: 'Pasta', amount: 380 },
]
export const receipt = {
  merchant: 'FreshMart Central',
  group: 'Friends & family',
  currency: 'USD',
  date: '2026-10-12',
  items,
  total: items.reduce((sum, item) => sum + item.amount, 0),
}
export const money = (cents: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: receipt.currency,
  }).format(cents / 100)
export const receiptDate = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeZone: 'UTC',
}).format(new Date(`${receipt.date}T12:00:00Z`))

export const participants = ['Alex', 'Jamie'] as const
export const itemParticipants = [
  ['Alex', 'Jamie'],
  ['Jamie'],
  ['Alex', 'Jamie'],
] as const
export const allocations = participants.map((name) => ({
  name,
  amount: receipt.items.reduce((sum, item, index) => {
    const names: readonly string[] = itemParticipants[index]
    return sum + (names.includes(name) ? item.amount / names.length : 0)
  }, 0),
}))
