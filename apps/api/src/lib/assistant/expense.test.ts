import { expenseApiSchema } from '@spliit/domain'

import '../../test/mocks'
import { prismaMock } from '../../test/state'
import {
  decimalToMinorUnits,
  localDateFromOffset,
  openConfirmation,
  prepareAssistantExpense,
  prepareExpenseInputSchema,
  sealConfirmation,
} from './expense'

const baseExpense = {
  expenseDate: new Date('2026-07-28T00:00:00.000Z'),
  title: 'Dinner',
  category: 'general' as const,
  amount: 10_00,
  paidBySplitMode: 'BY_AMOUNT' as const,
  paidByList: [{ participant: 'payer', shares: 10_00 }],
  isMultiPayer: false,
  splitMode: 'EVENLY' as const,
  paidFor: [
    { participant: 'payer', shares: 1 },
    { participant: 'friend', shares: 1 },
  ],
  isReimbursement: false,
  documents: [],
  recurrenceRule: 'NONE' as const,
  recurrence: null,
}

function mockAssistantGroup() {
  prismaMock.groupMember.findUnique.mockResolvedValue({
    status: 'ACTIVE',
    ledgerParticipant: { id: 'alice' },
    group: {
      id: 'group-a',
      name: 'Portugal',
      archived: false,
      groupType: 'GROUP',
      ledger: {
        currency: '$',
        currencyCode: 'USD',
        participants: [
          {
            id: 'alice',
            displayName: null,
            groupMember: {
              accountId: 'account-a',
              account: { name: 'Alice' },
            },
            invitations: [],
          },
          {
            id: 'alex',
            displayName: 'Alex',
            groupMember: null,
            invitations: [],
          },
          {
            id: 'joe',
            displayName: 'Joe',
            groupMember: null,
            invitations: [],
          },
        ],
      },
      members: [
        { accountId: 'account-a', account: { name: 'Alice' } },
        { accountId: 'account-b', account: { name: 'Alex' } },
        { accountId: 'account-c', account: { name: 'Joe' } },
      ],
    },
  } as never)
  prismaMock.accountGroupDefaultSplit.findUnique.mockResolvedValue(null)
}

describe('assistant expense normalization', () => {
  it('converts decimal strings without floating point rounding', () => {
    expect(decimalToMinorUnits('12.50', 2)).toBe(1250)
    expect(decimalToMinorUnits('12.5', 2)).toBe(1250)
    expect(decimalToMinorUnits('12', 2)).toBe(1200)
    expect(decimalToMinorUnits('1.234', 3)).toBe(1234)
  })

  it('rejects unsupported precision and malformed values', () => {
    expect(() => decimalToMinorUnits('1.001', 2)).toThrow(
      'more than 2 decimal places',
    )
    expect(() => decimalToMinorUnits('-1', 2)).toThrow('Invalid decimal')
    expect(() => decimalToMinorUnits('1e3', 2)).toThrow('Invalid decimal')
  })

  it('selects today using the advisory UTC offset', () => {
    const nearMidnight = new Date('2026-07-28T23:30:00.000Z')
    expect(localDateFromOffset(nearMidnight, 120).toISOString()).toBe(
      '2026-07-29T00:00:00.000Z',
    )
    expect(localDateFromOffset(nearMidnight, -300).toISOString()).toBe(
      '2026-07-28T00:00:00.000Z',
    )
  })

  it.each([
    {
      splitMode: 'EVENLY',
      paidFor: [
        { participant: 'payer', shares: 1 },
        { participant: 'friend', shares: 1 },
      ],
    },
    {
      splitMode: 'BY_SHARES',
      paidFor: [
        { participant: 'payer', shares: 2 },
        { participant: 'friend', shares: 1 },
      ],
    },
    {
      splitMode: 'BY_PERCENTAGE',
      paidFor: [
        { participant: 'payer', shares: 2500 },
        { participant: 'friend', shares: 7500 },
      ],
    },
    {
      splitMode: 'BY_AMOUNT',
      paidFor: [
        { participant: 'payer', shares: 300 },
        { participant: 'friend', shares: 700 },
      ],
    },
  ] as const)('accepts $splitMode beneficiary splits', (split) => {
    expect(
      expenseApiSchema.safeParse({ ...baseExpense, ...split }).success,
    ).toBe(true)
  })

  it('accepts exact multi-payer totals and rejects invalid totals', () => {
    const multiPayer = {
      ...baseExpense,
      isMultiPayer: true,
      paidByList: [
        { participant: 'payer', shares: 400 },
        { participant: 'friend', shares: 600 },
      ],
    }
    expect(expenseApiSchema.safeParse(multiPayer).success).toBe(true)
    expect(
      expenseApiSchema.safeParse({
        ...multiPayer,
        paidByList: [
          { participant: 'payer', shares: 400 },
          { participant: 'friend', shares: 500 },
        ],
      }).success,
    ).toBe(false)
  })

  it('rejects flat/itemized conflicts and remainder-only inputs', () => {
    expect(
      prepareExpenseInputSchema.safeParse({
        groupId: 'group-a',
        amount: '10',
        title: 'Receipt',
        split: { mode: 'EVENLY' },
        items: [{ title: 'Pizza', unitPrice: '10', quantity: 1 }],
      }).success,
    ).toBe(false)
    expect(
      prepareExpenseInputSchema.safeParse({
        groupId: 'group-a',
        amount: '10',
        title: 'Receipt',
        remainderSplit: { mode: 'EVENLY' },
      }).success,
    ).toBe(false)
  })

  it('normalizes all four per-item split modes and quantities', async () => {
    mockAssistantGroup()

    const prepared = await prepareAssistantExpense(
      {
        groupId: 'group-a',
        amount: '34',
        title: 'Mixed receipt',
        items: [
          {
            title: 'Shared starter',
            unitPrice: '5',
            quantity: 2,
            split: { mode: 'EVENLY', participantIds: ['alice', 'alex'] },
          },
          {
            title: 'Beers',
            unitPrice: '3',
            quantity: 3,
            split: {
              mode: 'BY_SHARES',
              shares: [
                { participantId: 'alice', shares: 1 },
                { participantId: 'alex', shares: 2 },
              ],
            },
          },
          {
            title: 'Dessert',
            unitPrice: '8',
            quantity: 1,
            split: {
              mode: 'BY_PERCENTAGE',
              shares: [
                { participantId: 'alice', percentage: '25' },
                { participantId: 'joe', percentage: '75' },
              ],
            },
          },
          {
            title: 'Sides',
            unitPrice: '7',
            quantity: 1,
            split: {
              mode: 'BY_AMOUNT',
              shares: [
                { participantId: 'alex', amount: '3' },
                { participantId: 'joe', amount: '4' },
              ],
            },
          },
        ],
      },
      'account-a',
      {
        now: new Date('2026-07-28T10:00:00.000Z'),
        resolveConversion: vi.fn().mockResolvedValue({
          conversionSource: null,
          conversionRate: null,
          originalAmount: null,
          originalCurrency: null,
          ledgerAmountMinor: 3400,
          inputAmountMinor: 3400,
        }),
      },
    )

    expect(prepared.expense.splitMode).toBe('ITEMIZED')
    expect(prepared.expense.items).toEqual([
      expect.objectContaining({
        title: 'Shared starter',
        unitPrice: 500,
        quantity: 2,
        amount: 1000,
        splitMode: 'EVENLY',
      }),
      expect.objectContaining({ title: 'Beers', splitMode: 'BY_SHARES' }),
      expect.objectContaining({
        title: 'Dessert',
        splitMode: 'BY_PERCENTAGE',
        paidFor: expect.arrayContaining([
          { participant: 'alice', shares: 2500 },
          { participant: 'joe', shares: 7500 },
        ]),
      }),
      expect.objectContaining({
        title: 'Sides',
        splitMode: 'BY_AMOUNT',
        paidFor: expect.arrayContaining([
          { participant: 'alex', shares: 300 },
          { participant: 'joe', shares: 400 },
        ]),
      }),
    ])
    expect(prepared.expense.itemizedRemainder).toBeUndefined()
    expect(prepared.preview.items).toHaveLength(4)
    expect(
      prepared.expense.paidFor.reduce((sum, row) => sum + row.shares, 0),
    ).toBe(3400)
  })

  it('allocates receipt remainder proportionally to exact item subtotals', async () => {
    mockAssistantGroup()

    const prepared = await prepareAssistantExpense(
      {
        groupId: 'group-a',
        amount: '60',
        title: 'Dinner receipt',
        items: [
          {
            title: 'Beer',
            unitPrice: '3',
            quantity: 5,
            split: {
              mode: 'BY_SHARES',
              shares: [
                { participantId: 'alex', shares: 2 },
                { participantId: 'alice', shares: 3 },
              ],
            },
          },
          {
            title: 'Steak',
            unitPrice: '30',
            quantity: 1,
            split: { mode: 'EVENLY', participantIds: ['joe'] },
          },
          {
            title: 'Fries',
            unitPrice: '10',
            quantity: 1,
            split: {
              mode: 'EVENLY',
              participantIds: ['alex', 'alice'],
            },
          },
        ],
      },
      'account-a',
      {
        resolveConversion: vi.fn().mockResolvedValue({
          conversionSource: null,
          conversionRate: null,
          originalAmount: null,
          originalCurrency: null,
          ledgerAmountMinor: 6000,
          inputAmountMinor: 6000,
        }),
      },
    )

    expect(prepared.expense.itemizedRemainder).toEqual({
      splitMode: 'BY_AMOUNT',
      paidFor: [
        { participant: 'alex', shares: 100 },
        { participant: 'alice', shares: 127 },
        { participant: 'joe', shares: 273 },
      ],
    })
    expect(prepared.expense.paidFor).toEqual([
      { participant: 'alex', shares: 1200 },
      { participant: 'alice', shares: 1527 },
      { participant: 'joe', shares: 3273 },
    ])
    expect(prepared.preview.remainder?.amountMinor).toBe(500)
    expect(prepared.preview.defaults).toContainEqual({
      field: 'remainder',
      label: 'Tax, tip and remainder',
      value: 'Proportional to item subtotals',
    })
    const opened = await openConfirmation(prepared.confirmationToken)
    expect(opened.expense.items).toEqual(prepared.expense.items)
    expect(opened.expense.itemizedRemainder).toEqual(
      prepared.expense.itemizedRemainder,
    )
    expect(opened.expense.paidFor).toEqual(prepared.expense.paidFor)
  })

  it('uses the saved group split for item defaults and rejects invalid items', async () => {
    mockAssistantGroup()
    prismaMock.accountGroupDefaultSplit.findUnique.mockResolvedValue({
      splitMode: 'BY_PERCENTAGE',
      paidFor: [
        { participantId: 'alice', shares: 2500 },
        { participantId: 'alex', shares: 7500 },
      ],
    } as never)
    const conversion = vi.fn().mockResolvedValue({
      conversionSource: null,
      conversionRate: null,
      originalAmount: null,
      originalCurrency: null,
      ledgerAmountMinor: 1000,
      inputAmountMinor: 1000,
    })

    const prepared = await prepareAssistantExpense(
      {
        groupId: 'group-a',
        amount: '10',
        title: 'Pizza',
        items: [{ title: 'Pizza', unitPrice: '10', quantity: 1 }],
      },
      'account-a',
      { resolveConversion: conversion },
    )
    expect(prepared.expense.items?.[0]).toMatchObject({
      splitMode: 'BY_PERCENTAGE',
      paidFor: [
        { participant: 'alice', shares: 2500 },
        { participant: 'alex', shares: 7500 },
      ],
    })
    expect(prepared.preview.defaults).toContainEqual({
      field: 'item-splits',
      label: 'Item splits',
      value: 'Your saved group split',
    })

    await expect(
      prepareAssistantExpense(
        {
          groupId: 'group-a',
          amount: '5',
          title: 'Bad receipt',
          items: [{ title: 'Pizza', unitPrice: '6', quantity: 1 }],
        },
        'account-a',
        { resolveConversion: conversion },
      ),
    ).rejects.toThrow('Item totals cannot exceed')
    await expect(
      prepareAssistantExpense(
        {
          groupId: 'group-a',
          amount: '5',
          title: 'Bad participant',
          items: [
            {
              title: 'Pizza',
              unitPrice: '5',
              quantity: 1,
              split: {
                mode: 'EVENLY',
                participantIds: ['stale-participant'],
              },
            },
          ],
        },
        'account-a',
        { resolveConversion: conversion },
      ),
    ).rejects.toThrow('Unknown or stale participant')
  })

  it('normalizes a foreign-currency expense and seals the server rate', async () => {
    prismaMock.groupMember.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      ledgerParticipant: { id: 'payer' },
      group: {
        id: 'group-a',
        name: 'Trip',
        archived: false,
        groupType: 'GROUP',
        ledger: {
          currency: 'ден',
          currencyCode: 'MKD',
          participants: [
            {
              id: 'payer',
              displayName: null,
              groupMember: {
                accountId: 'account-a',
                account: { name: 'Alice' },
              },
              invitations: [],
            },
            {
              id: 'friend',
              displayName: 'Bob',
              groupMember: null,
              invitations: [],
            },
          ],
        },
        members: [
          { accountId: 'account-a', account: { name: 'Alice' } },
          { accountId: 'account-b', account: { name: 'Bob' } },
        ],
      },
    } as never)
    const resolveConversion = vi.fn().mockResolvedValue({
      conversionSource: 'EXCHANGE',
      conversionRate: 61.5,
      originalAmount: 1500,
      originalCurrency: 'EUR',
      ledgerAmountMinor: 92250,
      inputAmountMinor: 1500,
    })

    const prepared = await prepareAssistantExpense(
      {
        groupId: 'group-a',
        amount: '15',
        title: 'Bar Skopje',
        currencyCode: 'eur',
        split: { mode: 'EVENLY' },
      },
      'account-a',
      {
        now: new Date('2026-07-28T10:00:00.000Z'),
        resolveConversion,
      },
    )

    expect(prepared.expense.amount).toBe(1500)
    expect(prepared.expense.conversion).toEqual({
      type: 'exchange',
      currency: 'EUR',
    })
    expect(prepared.preview.expenseCurrency).toMatchObject({
      code: 'EUR',
      decimalDigits: 2,
    })
    expect(prepared.preview.conversion).toMatchObject({
      ledgerAmountMinor: 92250,
      ledgerCurrencyCode: 'MKD',
      rate: 61.5,
    })
    expect(
      (await openConfirmation(prepared.confirmationToken)).conversion,
    ).toEqual(expect.objectContaining({ conversionRate: 61.5 }))
  })
})

describe('assistant confirmation token', () => {
  const claims = {
    accountId: 'account-a',
    groupId: 'group-a',
    ledgerCurrencyCode: 'USD',
    requestId: 'f58ea0c0-82a8-4eb1-a653-67ff76b2cc81',
    expense: expenseApiSchema.parse(baseExpense),
    conversion: {
      conversionSource: null,
      conversionRate: null,
      originalAmount: null,
      originalCurrency: null,
      ledgerAmountMinor: 1000,
      inputAmountMinor: 1000,
    },
  }

  afterEach(() => vi.useRealTimers())

  it('round-trips the exact normalized expense without exposing plaintext', async () => {
    const token = await sealConfirmation(claims)
    expect(token).not.toContain(claims.accountId)
    const opened = await openConfirmation(token)
    expect(opened).toEqual(claims)
  })

  it('rejects tampering and expiry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-28T10:00:00.000Z'))
    const token = await sealConfirmation(claims)
    const parts = token.split('.')
    parts[3] = `${parts[3][0] === 'a' ? 'b' : 'a'}${parts[3].slice(1)}`
    await expect(openConfirmation(parts.join('.'))).rejects.toThrow()
    vi.setSystemTime(new Date('2026-07-28T10:16:00.000Z'))
    await expect(openConfirmation(token)).rejects.toThrow()
  })

  it('seals the exact server-resolved foreign-currency conversion', async () => {
    const foreignClaims = {
      ...claims,
      expense: expenseApiSchema.parse({
        ...baseExpense,
        conversion: { type: 'exchange', currency: 'EUR' },
      }),
      conversion: {
        conversionSource: 'EXCHANGE' as const,
        conversionRate: 65.1,
        originalAmount: 1000,
        originalCurrency: 'EUR',
        ledgerAmountMinor: 65100,
        inputAmountMinor: 1000,
      },
    }
    const opened = await openConfirmation(await sealConfirmation(foreignClaims))
    expect(opened.conversion).toEqual(foreignClaims.conversion)
    expect(opened.expense.conversion).toEqual({
      type: 'exchange',
      currency: 'EUR',
    })
  })
})
