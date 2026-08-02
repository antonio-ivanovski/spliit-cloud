import { describe, expect, it } from 'vitest'

import {
  beneficiarySplitSchema,
  createExpenseOutputSchema,
  expenseContextOutputSchema,
  groupSummaryOutputSchema,
  mcpToolOutputSchemas,
  prepareExpenseOutputSchema,
} from './schemas'

const preview = {
  group: {
    id: 'group-1',
    name: 'Portugal',
    currency: '$',
    currencyCode: 'USD',
    decimalDigits: 2,
  },
  expenseCurrency: {
    code: 'USD',
    symbol: '$',
    decimalDigits: 2,
  },
  title: 'Dinner',
  amountMinor: 5000,
  amount: '50',
  date: '2026-07-29',
  category: 'dining-out',
  notes: null,
  paidBy: [{ participantId: 'alice', name: 'Alice', shares: 5000 }],
  split: {
    mode: 'EVENLY' as const,
    participants: [
      { participantId: 'alice', name: 'Alice', shares: 1 },
      { participantId: 'bob', name: 'Bob', shares: 1 },
    ],
  },
  items: [],
  remainder: null,
  conversion: null,
  defaults: [],
}

describe('MCP tool output schemas', () => {
  it('defines an output schema for every exposed tool', () => {
    expect(Object.keys(mcpToolOutputSchemas).sort()).toEqual([
      'create-expense',
      'get-expense-context',
      'get-group-summary',
      'prepare-expense',
    ])
  })

  it('validates expense context output', () => {
    expect(
      expenseContextOutputSchema.parse({
        connectedAccount: { name: 'Antonio' },
        categories: [
          { id: 'dining-out', grouping: 'Food', name: 'Dining Out' },
        ],
        totalGroups: 1,
        truncated: false,
        groups: [
          {
            id: 'group-1',
            name: 'Portugal',
            type: 'GROUP',
            currency: '$',
            currencyCode: 'USD',
            callerParticipantId: 'alice',
            participantCount: 2,
            participants: [
              {
                id: 'alice',
                name: 'Alice',
                status: 'ACTIVE',
                isCaller: true,
                disambiguationLabel: 'Alice',
              },
              {
                id: 'bob',
                name: 'Bob',
                status: 'ACTIVE',
                isCaller: false,
                disambiguationLabel: 'Bob',
              },
            ],
            disambiguationLabel: 'Portugal',
          },
        ],
      }),
    ).toBeTruthy()
  })

  it('validates group summary output with integer-cent balances', () => {
    expect(
      groupSummaryOutputSchema.parse({
        connectedAccount: { name: 'Antonio' },
        group: {
          id: 'group-1',
          name: 'Portugal',
          type: 'GROUP',
          currency: '$',
          currencyCode: 'USD',
        },
        callerParticipantId: 'alice',
        participants: [
          { id: 'alice', name: 'Alice', status: 'ACTIVE' },
          { id: 'bob', name: 'Bob', status: 'ACTIVE' },
        ],
        defaultSplit: null,
        balances: {
          alice: { paid: 5000, paidFor: 2500, total: 2500 },
          bob: { paid: 0, paidFor: 2500, total: -2500 },
        },
        recentExpenses: [
          {
            id: 'expense-1',
            title: 'Dinner',
            amount: 5000,
            date: '2026-07-29',
            category: 'dining-out',
            paidBy: [
              {
                ledgerParticipant: {
                  id: 'alice',
                  name: 'Alice',
                  account: {
                    id: 'account-1',
                    name: 'Alice',
                    image: null,
                  },
                  removed: false,
                },
                shares: 5000,
              },
            ],
            paidFor: [
              {
                ledgerParticipant: {
                  id: 'bob',
                  name: 'Bob',
                  account: null,
                  removed: false,
                },
                shares: 1,
              },
            ],
          },
        ],
      }),
    ).toBeTruthy()
  })

  it('validates group summary output with decimal BY_SHARES shares', () => {
    const result = groupSummaryOutputSchema.safeParse({
      connectedAccount: { name: 'Antonio' },
      group: {
        id: 'group-1',
        name: 'Portugal',
        type: 'GROUP',
        currency: '$',
        currencyCode: 'USD',
      },
      callerParticipantId: 'alice',
      participants: [
        { id: 'alice', name: 'Alice', status: 'ACTIVE' },
        { id: 'bob', name: 'Bob', status: 'ACTIVE' },
      ],
      // BY_SHARES display decimals (stored 50 → 0.5) must parse, even though
      // other modes still return integers.
      defaultSplit: {
        mode: 'BY_SHARES',
        participants: [
          { participantId: 'alice', shares: 0.5 },
          { participantId: 'bob', shares: 1.1 },
        ],
      },
      balances: {
        alice: { paid: 5000, paidFor: 2500, total: 2500 },
        bob: { paid: 0, paidFor: 2500, total: -2500 },
      },
      recentExpenses: [
        {
          id: 'expense-1',
          title: 'Dinner',
          amount: 5000,
          date: '2026-07-29',
          category: 'dining-out',
          paidBy: [
            {
              ledgerParticipant: {
                id: 'alice',
                name: 'Alice',
                account: null,
                removed: false,
              },
              shares: 5000,
            },
          ],
          paidFor: [
            {
              ledgerParticipant: {
                id: 'bob',
                name: 'Bob',
                account: null,
                removed: false,
              },
              shares: 0.5,
            },
          ],
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('accepts decimal BY_SHARES tool input and rejects out-of-range or imprecise values', () => {
    const ok = beneficiarySplitSchema.safeParse({
      mode: 'BY_SHARES',
      shares: [
        { participantId: 'alice', shares: 0.5 },
        { participantId: 'bob', shares: 1.1 },
        { participantId: 'carol', shares: 1_000_000 },
      ],
    })
    expect(ok.success).toBe(true)

    const rejects: Array<{ participantId: string; shares: number }>[] = [
      [{ participantId: 'alice', shares: 0 }],
      [{ participantId: 'alice', shares: -0.5 }],
      [{ participantId: 'alice', shares: 1.001 }],
      [{ participantId: 'alice', shares: 1_000_000.01 }],
    ]
    for (const shares of rejects) {
      const result = beneficiarySplitSchema.safeParse({
        mode: 'BY_SHARES',
        shares,
      })
      expect(result.success, JSON.stringify(shares)).toBe(false)
    }
  })

  it('keeps the preparation schema free of confirmation credentials', () => {
    const result = prepareExpenseOutputSchema.parse({
      preview,
      expenseUrlBase: 'https://spliit.example/groups/group-1/expenses',
      confirmationToken: 'must-be-stripped',
    })

    expect(result).not.toHaveProperty('confirmationToken')
  })

  it('validates the idempotent create result', () => {
    expect(
      createExpenseOutputSchema.parse({
        expenseId: 'expense-1',
        groupId: 'group-1',
        alreadyCreated: false,
        expenseUrl: 'https://spliit.example/groups/group-1/expenses/expense-1',
      }),
    ).toBeTruthy()
  })
})
