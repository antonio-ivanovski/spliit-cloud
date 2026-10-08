import { describe, expect, it } from 'vitest'

import '../../../test/mocks'
import { prismaMock } from '../../../test/state'
import {
  getFinancialSummary,
  overviewRouter,
  summarizeBalances,
  summarizePeopleBalances,
} from './index'

const expense = (overrides: Record<string, unknown> = {}) =>
  ({
    ledgerId: 'ledger-1',
    amount: 1000,
    createdAt: new Date('2026-06-03T00:00:00Z'),
    splitMode: 'EVENLY',
    paidBySplitMode: 'BY_AMOUNT',
    originalAmount: null,
    originalCurrency: null,
    conversionRate: null,
    conversionSource: null,
    paidByList: [{ ledgerParticipantId: 'bob', shares: 1 }],
    paidFor: [
      { ledgerParticipantId: 'alice', shares: 1 },
      { ledgerParticipantId: 'bob', shares: 1 },
    ],
    items: [],
    itemizedRemainder: null,
    ...overrides,
  }) as never

describe('overview financial summaries', () => {
  it('distinguishes no expenses from an unavailable participant', () => {
    expect(getFinancialSummary([], 'alice')).toMatchObject({
      expenseCount: 0,
      netBalance: 0,
      state: 'NO_EXPENSES',
    })
    expect(getFinancialSummary([], null)).toMatchObject({
      expenseCount: 0,
      netBalance: null,
      state: 'UNAVAILABLE',
    })
  })

  it('uses the existing balance math and preserves the newest expense timestamp', () => {
    expect(
      getFinancialSummary(
        [
          expense(),
          expense({
            amount: 400,
            createdAt: new Date('2026-06-04T00:00:00Z'),
          }),
        ],
        'alice',
      ),
    ).toMatchObject({
      expenseCount: 2,
      netBalance: -700,
      state: 'YOU_OWE',
      latestExpenseCreatedAt: '2026-06-04T00:00:00.000Z',
    })
  })

  it('reports settled when the payer and share totals cancel out', () => {
    expect(
      getFinancialSummary(
        [
          expense(),
          expense({
            paidByList: [{ ledgerParticipantId: 'alice', shares: 1 }],
          }),
        ],
        'alice',
      ).state,
    ).toBe('SETTLED')
  })

  it('aggregates owed and owing totals per currency without netting them together', () => {
    expect(
      summarizeBalances([
        {
          ledger: { currency: '$', currencyCode: 'USD' },
          financialSummary: { netBalance: 1200 },
        },
        {
          ledger: { currency: '$', currencyCode: 'USD' },
          financialSummary: { netBalance: -500 },
        },
        {
          ledger: { currency: '€', currencyCode: 'EUR' },
          financialSummary: { netBalance: 900 },
        },
        {
          ledger: { currency: '$', currencyCode: 'USD' },
          financialSummary: { netBalance: 0 },
        },
      ]),
    ).toEqual([
      {
        currency: '$',
        currencyCode: 'USD',
        owedToYou: 1200,
        owedToYouGroupCount: 1,
        youOwe: 500,
        youOweGroupCount: 1,
      },
      {
        currency: '€',
        currencyCode: 'EUR',
        owedToYou: 900,
        owedToYouGroupCount: 1,
        youOwe: 0,
        youOweGroupCount: 0,
      },
    ])
  })

  it('nets account-backed people by currency while preserving group contributions', () => {
    expect(
      summarizePeopleBalances(
        [
          {
            id: 'group-1',
            displayName: 'Beach trip',
            currency: { currency: '$', currencyCode: 'USD' },
            currentParticipantId: 'alice-1',
            balances: {
              'alice-1': { paid: 100, paidFor: 0, total: 100 },
              'bob-1': { paid: 0, paidFor: 100, total: -100 },
            },
          },
          {
            id: 'group-2',
            displayName: 'Cabin weekend',
            currency: { currency: '$', currencyCode: 'USD' },
            currentParticipantId: 'alice-2',
            balances: {
              'alice-2': { paid: 0, paidFor: 40, total: -40 },
              'bob-2': { paid: 40, paidFor: 0, total: 40 },
            },
          },
          {
            id: 'group-3',
            displayName: 'Paris trip',
            currency: { currency: '€', currencyCode: 'EUR' },
            currentParticipantId: 'alice-3',
            balances: {
              'alice-3': { paid: 100, paidFor: 0, total: 100 },
              'bob-3': { paid: 0, paidFor: 100, total: -100 },
            },
          },
        ],
        [
          {
            id: 'bob-1',
            name: 'Bob',
            account: { id: 'account-bob', name: 'Bob', image: null },
          },
          {
            id: 'bob-2',
            name: 'Bob',
            account: { id: 'account-bob', name: 'Bob', image: null },
          },
          {
            id: 'bob-3',
            name: 'Bob',
            account: { id: 'account-bob', name: 'Bob', image: null },
          },
        ],
      ),
    ).toEqual([
      {
        key: 'account:account-bob',
        name: 'Bob',
        account: { id: 'account-bob', name: 'Bob', image: null },
        currencies: [
          {
            currency: '€',
            currencyCode: 'EUR',
            netAmount: 100,
            groups: [
              { groupId: 'group-3', groupName: 'Paris trip', amount: 100 },
            ],
          },
          {
            currency: '$',
            currencyCode: 'USD',
            netAmount: 60,
            groups: [
              { groupId: 'group-1', groupName: 'Beach trip', amount: 100 },
              { groupId: 'group-2', groupName: 'Cabin weekend', amount: -40 },
            ],
          },
        ],
      },
    ])
  })

  it('keeps name-only participants separate across groups', () => {
    expect(
      summarizePeopleBalances(
        [
          {
            id: 'group-1',
            displayName: 'One',
            currency: { currency: '$', currencyCode: 'USD' },
            currentParticipantId: 'alice-1',
            balances: {
              'alice-1': { paid: 50, paidFor: 0, total: 50 },
              'person-1': { paid: 0, paidFor: 50, total: -50 },
            },
          },
          {
            id: 'group-2',
            displayName: 'Two',
            currency: { currency: '$', currencyCode: 'USD' },
            currentParticipantId: 'alice-2',
            balances: {
              'alice-2': { paid: 50, paidFor: 0, total: 50 },
              'person-2': { paid: 0, paidFor: 50, total: -50 },
            },
          },
        ],
        [
          { id: 'person-1', name: 'Sam', account: null },
          { id: 'person-2', name: 'Sam', account: null },
        ],
      ).map(({ key, name, currencies }) => ({ key, name, currencies })),
    ).toEqual([
      {
        key: 'participant:person-1',
        name: 'Sam',
        currencies: [
          {
            currency: '$',
            currencyCode: 'USD',
            netAmount: 50,
            groups: [{ groupId: 'group-1', groupName: 'One', amount: 50 }],
          },
        ],
      },
      {
        key: 'participant:person-2',
        name: 'Sam',
        currencies: [
          {
            currency: '$',
            currencyCode: 'USD',
            netAmount: 50,
            groups: [{ groupId: 'group-2', groupName: 'Two', amount: 50 }],
          },
        ],
      },
    ])
  })

  it('merges pending invitees sharing one real email across groups and friend ledgers', () => {
    const result = summarizePeopleBalances(
      [
        {
          id: 'group-1',
          displayName: 'Imported one',
          currency: { currency: '$', currencyCode: 'USD' },
          currentParticipantId: 'alice-1',
          balances: {
            'alice-1': { paid: 100, paidFor: 0, total: 100 },
            'bob-1': { paid: 0, paidFor: 100, total: -100 },
          },
        },
        {
          id: 'group-2',
          displayName: 'Imported two',
          currency: { currency: '$', currencyCode: 'USD' },
          currentParticipantId: 'alice-2',
          balances: {
            'alice-2': { paid: 100, paidFor: 0, total: 100 },
            'bob-2': { paid: 0, paidFor: 100, total: -100 },
          },
        },
        {
          id: 'friend-1',
          displayName: 'Bob',
          currency: { currency: '$', currencyCode: 'USD' },
          currentParticipantId: 'alice-3',
          balances: {
            'alice-3': { paid: 50, paidFor: 0, total: 50 },
            'bob-3': { paid: 0, paidFor: 50, total: -50 },
          },
        },
      ],
      [
        {
          id: 'bob-1',
          name: 'bob@example.com',
          account: null,
          inviteEmail: 'bob@example.com',
        },
        {
          id: 'bob-2',
          name: 'bob@example.com',
          account: null,
          inviteEmail: ' Bob@Example.com ',
        },
        {
          id: 'bob-3',
          name: 'bob@example.com',
          account: null,
          inviteEmail: 'bob@example.com',
        },
      ],
    )

    expect(result).toHaveLength(1)
    expect(result[0]?.key).toBe('email:bob@example.com')
    expect(result[0]?.currencies).toHaveLength(1)
    expect(result[0]?.currencies[0]?.netAmount).toBe(250)
    expect(result[0]?.currencies[0]?.groups).toHaveLength(3)
  })

  it('folds a pending invite into its accepted account entry', () => {
    const result = summarizePeopleBalances(
      [
        {
          id: 'group-1',
          displayName: 'Imported',
          currency: { currency: '$', currencyCode: 'USD' },
          currentParticipantId: 'alice-1',
          balances: {
            'alice-1': { paid: 100, paidFor: 0, total: 100 },
            'bob-1': { paid: 0, paidFor: 100, total: -100 },
          },
        },
        {
          id: 'friend-1',
          displayName: 'Bob',
          currency: { currency: '$', currencyCode: 'USD' },
          currentParticipantId: 'alice-2',
          balances: {
            'alice-2': { paid: 50, paidFor: 0, total: 50 },
            'bob-2': { paid: 0, paidFor: 50, total: -50 },
          },
        },
      ],
      [
        {
          id: 'bob-1',
          name: 'bob@example.com',
          account: null,
          inviteEmail: 'bob@example.com',
        },
        {
          id: 'bob-2',
          name: 'Bob',
          account: { id: 'account-bob', name: 'Bob', image: null },
          inviteEmail: 'bob@example.com',
        },
      ],
      new Map([
        ['bob@example.com', { id: 'account-bob', name: 'Bob', image: null }],
      ]),
    )

    expect(result).toHaveLength(1)
    expect(result[0]?.key).toBe('account:account-bob')
    expect(result[0]?.currencies[0]?.netAmount).toBe(150)
    expect(result[0]?.currencies[0]?.groups).toHaveLength(2)
  })

  it('never merges placeholder link emails', () => {
    const result = summarizePeopleBalances(
      [
        {
          id: 'group-1',
          displayName: 'One',
          currency: { currency: '$', currencyCode: 'USD' },
          currentParticipantId: 'alice-1',
          balances: {
            'alice-1': { paid: 50, paidFor: 0, total: 50 },
            'person-1': { paid: 0, paidFor: 50, total: -50 },
          },
        },
        {
          id: 'group-2',
          displayName: 'Two',
          currency: { currency: '$', currencyCode: 'USD' },
          currentParticipantId: 'alice-2',
          balances: {
            'alice-2': { paid: 50, paidFor: 0, total: 50 },
            'person-2': { paid: 0, paidFor: 50, total: -50 },
          },
        },
      ],
      [
        {
          id: 'person-1',
          name: 'Link',
          account: null,
          inviteEmail: 'abc@link.placeholder.local',
        },
        {
          id: 'person-2',
          name: 'Link',
          account: null,
          inviteEmail: 'xyz@link.placeholder.local',
        },
      ],
    )

    expect(result.map((person) => person.key).sort()).toEqual([
      'participant:person-1',
      'participant:person-2',
    ])
  })

  it('keeps offsetting groups visible when the net is zero', () => {
    const result = summarizePeopleBalances(
      [
        {
          id: 'group-1',
          displayName: 'Owed',
          currency: { currency: '$', currencyCode: 'USD' },
          currentParticipantId: 'alice-1',
          balances: {
            'alice-1': { paid: 100, paidFor: 0, total: 100 },
            'bob-1': { paid: 0, paidFor: 100, total: -100 },
          },
        },
        {
          id: 'group-2',
          displayName: 'Owe',
          currency: { currency: '$', currencyCode: 'USD' },
          currentParticipantId: 'alice-2',
          balances: {
            'alice-2': { paid: 0, paidFor: 100, total: -100 },
            'bob-2': { paid: 100, paidFor: 0, total: 100 },
          },
        },
      ],
      [
        {
          id: 'bob-1',
          name: 'Bob',
          account: { id: 'account-bob', name: 'Bob', image: null },
        },
        {
          id: 'bob-2',
          name: 'Bob',
          account: { id: 'account-bob', name: 'Bob', image: null },
        },
      ],
    )

    expect(result).toHaveLength(1)
    expect(result[0]?.currencies[0]?.netAmount).toBe(0)
    expect(result[0]?.currencies[0]?.groups).toEqual([
      { groupId: 'group-1', groupName: 'Owed', amount: 100 },
      { groupId: 'group-2', groupName: 'Owe', amount: -100 },
    ])
  })
})

describe('overviewRouter.get', () => {
  it('returns an empty authenticated overview without querying unrelated ledgers', async () => {
    prismaMock.groupMember.findMany.mockResolvedValue([] as never)
    prismaMock.accountGroupPreference.findMany.mockResolvedValue([] as never)

    const caller = overviewRouter.createCaller({
      auth: {
        session: { id: 'session-1' },
        user: {
          id: 'acct-1',
          email: 'alice@example.com',
          emailVerified: true,
          name: 'Alice',
        },
      },
    } as never)

    const result = await caller.get()

    expect(result.stats).not.toHaveProperty('friendCount')
    expect(result).toEqual({
      stats: {
        balanceSummaries: [],
        peopleBalances: [],
      },
      groups: [],
    })
    expect(prismaMock.expense.findMany).not.toHaveBeenCalled()
  })

  it('mixes saved view-only groups into the list without affecting balances', async () => {
    prismaMock.groupMember.findMany.mockResolvedValue([] as never)
    prismaMock.accountGroupPreference.findMany.mockResolvedValue([
      { groupId: 'view-group', starred: true, hidden: false },
    ] as never)
    prismaMock.accountSavedView.findMany.mockResolvedValue([
      {
        groupId: 'view-group',
        viewKey: 'secret',
        createdAt: new Date('2026-08-01T00:00:00Z'),
        lastOpenedAt: new Date('2026-08-02T00:00:00Z'),
        group: {
          name: 'Cabin trip',
          ledger: { currency: '$', currencyCode: 'USD' },
          _count: { members: 4 },
          members: [
            {
              account: {
                id: 'acct-ada',
                name: 'Ada',
                image: 'https://example.com/ada.png',
              },
            },
          ],
        },
      },
    ] as never)

    const caller = overviewRouter.createCaller({
      auth: {
        session: { id: 'session-1' },
        user: {
          id: 'acct-1',
          email: 'alice@example.com',
          emailVerified: true,
          name: 'Alice',
        },
      },
    } as never)

    const result = await caller.get()

    expect(result.stats.balanceSummaries).toEqual([])
    expect(result.groups).toEqual([
      expect.objectContaining({
        id: 'view-group',
        displayName: 'Cabin trip',
        access: 'VIEW_ONLY',
        viewKey: 'secret',
        memberCount: 4,
        lastOpenedAt: '2026-08-02T00:00:00.000Z',
        preference: { starred: true, hidden: false },
        memberAccounts: [
          {
            id: 'acct-ada',
            name: 'Ada',
            image: 'https://example.com/ada.png',
          },
        ],
        financialSummary: expect.objectContaining({
          state: 'UNAVAILABLE',
          latestExpenseCreatedAt: null,
        }),
      }),
    ])
  })
})
