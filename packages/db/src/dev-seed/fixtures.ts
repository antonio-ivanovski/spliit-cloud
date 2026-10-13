import { createHash } from 'node:crypto'

import {
  DEFAULT_CATEGORIES,
  expenseApiSchema,
  type Expense as ExpenseApiInput,
} from '@spliit/domain'

export type Scenario = {
  key: string
  name: string
  description: string
  currencyCode: string | null
  currency: string
  people: number
  archived?: boolean
  hidden?: boolean
  friend?: boolean
  viewerRole?: 'ADMIN' | 'MEMBER'
  expenses: Array<{
    key: string
    input: ExpenseApiInput
    conversionSource?: 'EXCHANGE' | 'CUSTOM' | 'EXACT'
  }>
}

// Stable, account-specific ids make reruns skip existing groups and isolate cleanup.
export function seedNamespace(accountId: string) {
  return `dev-seed-v1-${createHash('sha256').update(accountId).digest('hex').slice(0, 16)}`
}

export function buildScenarios(
  namespace: string,
  today = new Date(),
): Scenario[] {
  const date = (daysAgo: number) => {
    const value = new Date(today)
    value.setUTCHours(12, 0, 0, 0)
    value.setUTCDate(value.getUTCDate() - daysAgo)
    return value
  }
  const scenarios: Scenario[] = []
  const group = (
    key: string,
    name: string,
    description: string,
    options: Partial<Scenario> = {},
  ) => {
    const scenario: Scenario = {
      key,
      name: `[Demo] ${name}`,
      description,
      currencyCode: 'EUR',
      currency: '€',
      people: 4,
      expenses: [],
      ...options,
    }
    scenarios.push(scenario)
    return scenario
  }
  const participant = (scenario: Scenario, index: number) =>
    `${namespace}-${scenario.key}-p${index}`
  const add = (
    scenario: Scenario,
    key: string,
    title: string,
    amount: number,
    daysAgo: number,
    overrides: Partial<ExpenseApiInput> = {},
  ) => {
    const input = expenseApiSchema.parse({
      title,
      amount,
      expenseDate: date(daysAgo),
      expenseTimeZone: 'Europe/Rome',
      category: 'general',
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [{ participant: participant(scenario, 0), shares: amount }],
      splitMode: 'EVENLY',
      paidFor: Array.from({ length: scenario.people }, (_, index) => ({
        participant: participant(scenario, index),
        shares: 100,
      })),
      documents: [],
      recurrenceRule: 'NONE',
      notes: 'Synthetic development fixture.',
      ...overrides,
    })
    scenario.expenses.push({ key, input })
    return scenario.expenses.at(-1)!
  }

  const home = group(
    'home',
    'Shared household',
    'A year of history, income, budgets, presets, comments, and recurring bills.',
  )
  for (let month = 0; month < 13; month++) {
    add(home, `rent-${month}`, 'Monthly rent', 180000, month * 30, {
      category: 'rent',
      paidByList: [
        { participant: participant(home, month % 4), shares: 180000 },
      ],
    })
    add(
      home,
      `utilities-${month}`,
      'Electricity and internet',
      12500 + month * 117,
      month * 30 + 1,
      { category: 'electricity' },
    )
    add(
      home,
      `income-${month}`,
      'Shared solar energy refund',
      -2400,
      month * 30 + 2,
      { category: 'income' },
    )
  }
  for (let day = 0; day < 90; day += 3) {
    add(home, `groceries-${day}`, 'Weekly groceries 🥑', 3821 + day * 19, day, {
      category: 'groceries',
    })
  }
  add(home, 'personal', 'Personal bicycle repair', 4999, 0, {
    category: 'bicycle',
    paidFor: [{ participant: participant(home, 0), shares: 100 }],
  })
  add(home, 'other-only', 'Roommates dinner (viewer excluded)', 7200, 0, {
    category: 'dining-out',
    paidByList: [{ participant: participant(home, 1), shares: 7200 }],
    paidFor: [1, 2, 3].map((index) => ({
      participant: participant(home, index),
      shares: 100,
    })),
  })
  add(home, 'midnight', 'Late-night taxi across time zones', 2301, 1, {
    category: 'taxi',
    expenseDate: new Date(`${date(1).toISOString().slice(0, 10)}T23:30:00Z`),
    expenseTimeZone: 'Asia/Tokyo',
  })

  const trip = group(
    'trip',
    'Holiday split playground',
    'All splits and payer modes, itemization, conversion, subgroups, invitations, and rounding.',
  )
  const rows = (values: number[]) =>
    values.map((shares, index) => ({
      participant: participant(trip, index),
      shares,
    }))
  add(trip, 'odd-cent', 'Coffee: one cent divided four ways', 1, 0, {
    category: 'dining-out',
  })
  add(trip, 'shares', 'Villa: weighted nights', 110003, 8, {
    category: 'hotel',
    splitMode: 'BY_SHARES',
    paidFor: rows([100, 200, 300, 400]),
  })
  add(trip, 'percent', 'Car rental: 12.5 / 37.5 / 25 / 25%', 48001, 7, {
    category: 'car',
    splitMode: 'BY_PERCENTAGE',
    paidFor: rows([1250, 3750, 2500, 2500]),
  })
  add(trip, 'amount', 'Museum tickets: exact amounts', 9000, 6, {
    category: 'events-and-activities',
    splitMode: 'BY_AMOUNT',
    paidFor: rows([1000, 2000, 3000, 3000]),
  })
  for (const mode of [
    'EVENLY',
    'BY_SHARES',
    'BY_PERCENTAGE',
    'BY_AMOUNT',
  ] as const) {
    const values = {
      EVENLY: [100, 100],
      BY_SHARES: [100, 300],
      BY_PERCENTAGE: [2500, 7500],
      BY_AMOUNT: [2500, 7500],
    }[mode]
    add(trip, `payers-${mode}`, `Two payers: ${mode}`, 10000, 5, {
      category: 'groceries',
      isMultiPayer: true,
      paidBySplitMode: mode,
      paidByList: rows(values),
    })
  }
  for (const allocationMode of ['CUSTOM', 'PROPORTIONAL'] as const) {
    add(
      trip,
      `itemized-${allocationMode}`,
      `Restaurant receipt: ${allocationMode.toLowerCase()} tip`,
      9800,
      4,
      {
        category: 'dining-out',
        splitMode: 'ITEMIZED',
        items: [
          {
            title: 'Pizza',
            unitPrice: 1800,
            quantity: 2000,
            amount: 3600,
            splitMode: 'EVENLY',
            paidFor: rows([100, 100]),
          },
          {
            title: 'Pasta',
            unitPrice: 2200,
            quantity: 1000,
            amount: 2200,
            splitMode: 'BY_SHARES',
            paidFor: rows([100, 200, 100]),
          },
          {
            title: 'Drinks',
            unitPrice: 600,
            quantity: 4000,
            amount: 2400,
            splitMode: 'BY_PERCENTAGE',
            paidFor: rows([2500, 2500, 2500, 2500]),
          },
        ],
        itemizedRemainder: {
          splitMode: 'EVENLY',
          allocationMode,
          paidFor:
            allocationMode === 'CUSTOM' ? rows([100, 100, 100, 100]) : [],
        },
      },
    )
  }
  for (const conversionSource of ['EXCHANGE', 'CUSTOM', 'EXACT'] as const) {
    const expense = add(
      trip,
      `fx-${conversionSource}`,
      `USD tour: ${conversionSource.toLowerCase()} conversion`,
      10000,
      3,
      {
        category: 'events-and-activities',
        conversion:
          conversionSource === 'EXACT'
            ? { type: 'exact', currency: 'USD', amount: 9200 }
            : conversionSource === 'CUSTOM'
              ? { type: 'custom', currency: 'USD', rate: 0.92 }
              : { type: 'exchange', currency: 'USD' },
      },
    )
    expense.conversionSource = conversionSource
  }
  add(trip, 'settlement', 'Partial settlement to travel organizer', 3500, 1, {
    category: 'settlement',
    paidByList: rows([3500]),
    paidFor: [{ participant: participant(trip, 1), shares: 100 }],
  })
  add(
    trip,
    'long-notes',
    'Dinner with a deliberately long title — 東京 / Αθήνα / العربية / emoji 🍜 for narrow screens and search',
    12345,
    0,
    {
      category: 'dining-out',
      notes:
        'First line: everyone joined.\n\nSecond paragraph: vegetarian options, shared drinks, and a service charge.\n'.repeat(
          8,
        ),
    },
  )

  const imported = group(
    'imported',
    'Imported participants',
    'Name-only participants, a removed participant, and uncategorized history ready for linking and bulk categorization.',
    { people: 5 },
  )
  for (let index = 0; index < 45; index++) {
    add(
      imported,
      `row-${index}`,
      [
        'Supermarket',
        'Train ticket',
        'Hotel booking',
        'Coffee shop',
        'Unknown purchase',
      ][index % 5]!,
      1100 + index * 173,
      index,
      {
        paidByList: [
          {
            participant: participant(imported, index % 5),
            shares: 1100 + index * 173,
          },
        ],
      },
    )
  }
  const friend = group(
    'friend',
    '',
    'Two-person friend ledger with spending, income, and a partial repayment.',
    { people: 2, friend: true, name: '', currency: '$', currencyCode: 'USD' },
  )
  add(friend, 'dinner', 'Dinner with Alex', 6501, 0, { category: 'dining-out' })
  add(friend, 'refund', 'Concert refund', -2000, 2, { category: 'income' })
  add(friend, 'repayment', 'Alex repays part of dinner', 1500, 0, {
    category: 'settlement',
    paidByList: [{ participant: participant(friend, 1), shares: 1500 }],
    paidFor: [{ participant: participant(friend, 0), shares: 100 }],
  })
  const settled = group(
    'settled',
    'Settled weekend',
    'Exactly zero balances; archive and settlement empty states.',
    { people: 2 },
  )
  add(settled, 'hotel', 'Weekend hotel', 10000, 20, { category: 'hotel' })
  add(settled, 'repay', 'Full repayment', 5000, 19, {
    category: 'settlement',
    paidByList: [{ participant: participant(settled, 1), shares: 5000 }],
    paidFor: [{ participant: participant(settled, 0), shares: 100 }],
  })
  const archive = group(
    'archived',
    'Archived trip with balances',
    'Read-only archived group with outstanding debt.',
    { archived: true, currencyCode: 'GBP', currency: '£' },
  )
  add(archive, 'flight', 'Flights to Edinburgh', 67321, 200, {
    category: 'plane',
  })
  const hidden = group(
    'hidden',
    'Hidden club',
    'Per-account hidden group; recover it through hidden groups.',
    { hidden: true },
  )
  add(hidden, 'dues', 'Club membership', 2000, 10, { category: 'memberships' })
  group(
    'empty',
    'Empty group',
    'No expenses: onboarding, zero totals, and empty lists.',
    { people: 1 },
  )
  const member = group(
    'member',
    'Member permissions',
    'Viewer has MEMBER role; Alex is the admin.',
    { viewerRole: 'MEMBER' },
  )
  add(member, 'own', 'Expense created by viewer', 5000, 0, {
    category: 'groceries',
  })
  add(member, 'peer', 'Expense created by another member', 7800, 1, {
    category: 'dining-out',
  })
  const custom = group(
    'custom',
    'Custom currency',
    'Non-ISO currency and separate homepage currency bucket.',
    { currencyCode: null, currency: 'tokens' },
  )
  add(custom, 'tokens', 'Board game tokens', 4500, 0, { category: 'games' })
  const history = group(
    'history',
    'Large history & categories',
    'Pagination, search, report/export, every assignable category, and 18 months of charts.',
    { currencyCode: 'USD', currency: '$' },
  )
  const categories = DEFAULT_CATEGORIES.filter(
    (category) => category.id !== 'settlement' && category.id !== 'income',
  )
  for (let index = 0; index < 360; index++) {
    const category = categories[index % categories.length]!
    add(
      history,
      `history-${index}`,
      `${category.id} sample ${index + 1}`,
      101 + ((index * 7919) % 95000),
      Math.floor((index * 550) / 360),
      {
        category: category.id,
        paidByList: [
          {
            participant: participant(history, index % 4),
            shares: 101 + ((index * 7919) % 95000),
          },
        ],
      },
    )
  }
  return scenarios
}
