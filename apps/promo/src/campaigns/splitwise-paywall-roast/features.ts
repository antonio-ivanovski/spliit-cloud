/**
 * Value order for the switching audience; capabilities traced to the app
 * feature catalog.
 */
export const roastFeatures = [
  'Flexible expense splits',
  'Balances and settlements',
  'Currency conversion',
  'Offline access',
  'Recurring expenses',
  'Itemized splits',
  'Multiple payers',
  'Groups and friends',
  'CSV import',
  'Expense search',
  'Budgets',
  'Statistics',
  'Receipt scanning',
  'PDF reports',
  'QR invites',
  'Passkeys',
  'Notifications',
  'Activity history',
  'Multiple languages',
  'Self-hosting',
]
export const featureSegments = roastFeatures.map((text, index) => ({
  text,
  rate: 1.32 ** index,
}))
