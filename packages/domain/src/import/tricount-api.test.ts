import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'

import { extractTricountToken, parseTricountApiResponse } from './tricount-api'
import { ImportError } from './types'

function membership(name: string) {
  return {
    RegistryMembershipNonUser: {
      alias: { display_name: name },
    },
  }
}

function allocation(name: string, value: string) {
  return {
    amount: { currency: 'USD', value },
    membership: membership(name),
    type: 'RATIO',
    share_ratio: 1,
  }
}

/** Shape mirrors mlaily/TricountApi samples.json (tMjbqgwJxaikhUbkNz). */
const SAMPLE_PAYLOAD = {
  Response: [
    {
      Registry: {
        title: 'City trip',
        description: 'This is a sample tricount',
        currency: 'USD',
        public_identifier_token: 'tMjbqgwJxaikhUbkNz',
        memberships: [
          membership('Julia'),
          membership('Alex'),
          membership('Brian'),
          membership('Thomas'),
        ],
        all_registry_entry: [
          {
            RegistryEntry: {
              id: 860966150,
              uuid: '67f58c69-cc73-4d08-aad8-ccbc55f90487',
              status: 'ACTIVE',
              amount: { currency: 'USD', value: '-85.00' },
              amount_local: { currency: 'USD', value: '-85.00' },
              exchange_rate: '1',
              description: 'Hotel',
              type: 'MANUAL',
              type_transaction: 'NORMAL',
              membership_owned: membership('Alex'),
              allocations: [
                allocation('Alex', '-20.00'),
                allocation('Julia', '-20.00'),
                allocation('Thomas', '-20.00'),
                {
                  amount: { currency: 'USD', value: '-25.00' },
                  membership: membership('Brian'),
                  type: 'AMOUNT',
                },
              ],
              attachment: [],
              category: 'UNCATEGORIZED',
              category_custom: null,
              date: '2018-10-16 17:46:56.000000',
            },
          },
          {
            RegistryEntry: {
              id: 860966149,
              status: 'ACTIVE',
              amount: { currency: 'USD', value: '-13.00' },
              amount_local: { currency: 'USD', value: '-13.00' },
              exchange_rate: '1',
              description: 'Picnic',
              type: 'MANUAL',
              type_transaction: 'NORMAL',
              membership_owned: membership('Brian'),
              allocations: [
                allocation('Alex', '-3.25'),
                allocation('Julia', '-3.25'),
                allocation('Thomas', '-3.25'),
                allocation('Brian', '-3.25'),
              ],
              attachment: [],
              category: 'UNCATEGORIZED',
              category_custom: null,
              date: '2018-10-16 17:45:56.000000',
            },
          },
        ],
      },
    },
  ],
  Pagination: { future_url: null, newer_url: null, older_url: null },
}

/**
 * Anonymized shape of a real two-member MKD share-link response. Names, titles,
 * ids, uuids, token, and group title are all synthetic; only the structural
 * shapes are preserved. Covers what SAMPLE_PAYLOAD does not:
 *
 * - Two members, non-USD group currency (MKD), `null` group description
 * - Uneven 6:4 ratio splits, including reversed allocation order (payer last)
 * - A BALANCE settlement whose payer self-allocates `0.00` (AMOUNT type)
 * - A foreign-currency entry (EUR spent, MKD booked) with a non-1 `exchange_rate`
 *   whose rounded cent shares no longer reduce to a clean ratio (falls through
 *   to BY_AMOUNT)
 */
const MKD_PAYLOAD = {
  Response: [
    {
      Registry: {
        title: 'Lake house 2025',
        description: null,
        currency: 'MKD',
        public_identifier_token: 'tLakeHouse2025XyZ012',
        memberships: [membership('Alex'), membership('Noor')],
        all_registry_entry: [
          {
            RegistryEntry: {
              id: 101,
              uuid: '11111111-1111-4111-8111-111111111111',
              status: 'ACTIVE',
              amount: { currency: 'MKD', value: '-511.00' },
              amount_local: { currency: 'MKD', value: '-511.00' },
              exchange_rate: '1',
              description: 'Utilities Dec',
              type: 'MANUAL',
              type_transaction: 'NORMAL',
              membership_owned: membership('Noor'),
              allocations: [
                {
                  amount: { currency: 'MKD', value: '-255.50' },
                  amount_local: { currency: 'MKD', value: '-255.50' },
                  membership: membership('Alex'),
                  type: 'RATIO',
                  share_ratio: 1,
                },
                {
                  amount: { currency: 'MKD', value: '-255.50' },
                  amount_local: { currency: 'MKD', value: '-255.50' },
                  membership: membership('Noor'),
                  type: 'RATIO',
                  share_ratio: 1,
                },
              ],
              category: 'UNCATEGORIZED',
              category_custom: null,
              date: '2025-12-30 00:03:43.683000',
            },
          },
          {
            RegistryEntry: {
              id: 102,
              uuid: '22222222-2222-4222-8222-222222222222',
              status: 'ACTIVE',
              amount: { currency: 'MKD', value: '-5000.00' },
              amount_local: { currency: 'MKD', value: '-5000.00' },
              exchange_rate: '1',
              description: 'Groceries',
              type: 'MANUAL',
              type_transaction: 'NORMAL',
              membership_owned: membership('Alex'),
              allocations: [
                {
                  amount: { currency: 'MKD', value: '-3000.00' },
                  amount_local: { currency: 'MKD', value: '-3000.00' },
                  membership: membership('Alex'),
                  type: 'RATIO',
                  share_ratio: 6,
                },
                {
                  amount: { currency: 'MKD', value: '-2000.00' },
                  amount_local: { currency: 'MKD', value: '-2000.00' },
                  membership: membership('Noor'),
                  type: 'RATIO',
                  share_ratio: 4,
                },
              ],
              category: 'UNCATEGORIZED',
              category_custom: null,
              date: '2025-11-05 09:47:29.588000',
            },
          },
          {
            RegistryEntry: {
              id: 103,
              uuid: '33333333-3333-4333-8333-333333333333',
              status: 'ACTIVE',
              amount: { currency: 'MKD', value: '-9160.00' },
              amount_local: { currency: 'MKD', value: '-9160.00' },
              exchange_rate: '1',
              description: 'Booking fee',
              type: 'MANUAL',
              type_transaction: 'NORMAL',
              membership_owned: membership('Noor'),
              allocations: [
                {
                  amount: { currency: 'MKD', value: '-3664.00' },
                  amount_local: { currency: 'MKD', value: '-3664.00' },
                  membership: membership('Alex'),
                  type: 'RATIO',
                  share_ratio: 4,
                },
                {
                  amount: { currency: 'MKD', value: '-5496.00' },
                  amount_local: { currency: 'MKD', value: '-5496.00' },
                  membership: membership('Noor'),
                  type: 'RATIO',
                  share_ratio: 6,
                },
              ],
              category: 'UNCATEGORIZED',
              category_custom: null,
              date: '2025-08-03 07:46:12.029000',
            },
          },
          {
            RegistryEntry: {
              id: 104,
              uuid: '44444444-4444-4444-8444-444444444444',
              status: 'ACTIVE',
              amount: { currency: 'MKD', value: '-80532.51' },
              amount_local: { currency: 'MKD', value: '-80532.51' },
              exchange_rate: '1',
              description: 'Reimbursement',
              type: 'MANUAL',
              type_transaction: 'BALANCE',
              membership_owned: membership('Noor'),
              allocations: [
                {
                  amount: { currency: 'MKD', value: '-80532.51' },
                  amount_local: { currency: 'MKD', value: '-80532.51' },
                  membership: membership('Alex'),
                  type: 'AMOUNT',
                },
                {
                  amount: { currency: 'MKD', value: '0.00' },
                  amount_local: { currency: 'MKD', value: '0.00' },
                  membership: membership('Noor'),
                  type: 'AMOUNT',
                },
              ],
              category: 'UNCATEGORIZED',
              category_custom: null,
              date: '2026-01-03 14:51:15.213000',
            },
          },
          {
            RegistryEntry: {
              id: 105,
              uuid: '55555555-5555-4555-8555-555555555555',
              status: 'ACTIVE',
              amount: { currency: 'MKD', value: '-36141.28' },
              amount_local: { currency: 'EUR', value: '-587.00' },
              exchange_rate: '61.56946718730453',
              description: 'Guest apartments Jul',
              type: 'MANUAL',
              type_transaction: 'NORMAL',
              membership_owned: membership('Alex'),
              allocations: [
                {
                  amount: { currency: 'MKD', value: '-21684.77' },
                  amount_local: { currency: 'EUR', value: '-352.20' },
                  membership: membership('Alex'),
                  type: 'RATIO',
                  share_ratio: 6,
                },
                {
                  amount: { currency: 'MKD', value: '-14456.51' },
                  amount_local: { currency: 'EUR', value: '-234.80' },
                  membership: membership('Noor'),
                  type: 'RATIO',
                  share_ratio: 4,
                },
              ],
              category: 'UNCATEGORIZED',
              category_custom: null,
              date: '2025-07-15 11:40:21.440000',
            },
          },
        ],
      },
    },
  ],
}

describe('parseTricountApiResponse', () => {
  it.effect('normalizes the registry payload with exact shares', () =>
    Effect.gen(function* () {
      const source = yield* parseTricountApiResponse(
        SAMPLE_PAYLOAD,
        'https://tricount.com/tMjbqgwJxaikhUbkNz',
      )
      expect(source.provider).toBe('TRICOUNT')
      expect(source.name).toBe('City trip')
      expect(source.currencyCode).toBe('USD')
      expect(source.sourceUrl).toBe('https://tricount.com/tMjbqgwJxaikhUbkNz')
      expect(source.participants.map((p) => p.sourceName)).toEqual([
        'Julia',
        'Alex',
        'Brian',
        'Thomas',
      ])
      expect(source.expenses).toHaveLength(2)

      const hotel = source.expenses.find((e) => e.title === 'Hotel')!
      expect(hotel.sourceId).toBe('860966150')
      expect(hotel.amount).toBe(8500)
      expect(hotel.expenseDate).toBe('2018-10-16')
      // Uneven 20/20/20/25 split reduces to the 4/4/4/5 ratio in fixed
      // units (BY_SHARES weights are ratios, not cents).
      expect(hotel.splitMode).toBe('BY_SHARES')
      expect(hotel.paidFor.map((p) => p.shares).sort((a, b) => a - b)).toEqual([
        400, 400, 400, 500,
      ])

      const picnic = source.expenses.find((e) => e.title === 'Picnic')!
      expect(picnic.splitMode).toBe('EVENLY')
      expect(picnic.paidFor.reduce((s, p) => s + p.shares, 0)).toBe(1300)
    }),
  )

  it.effect('rejects non-registry payloads with a stable code', () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        parseTricountApiResponse({ nope: true }, null),
      )
      expect(failure).toBeInstanceOf(ImportError)
      expect(failure.code).toBe('TRICOUNT_INVALID_RESPONSE')
    }),
  )

  it.effect(
    'normalizes a two-member MKD group with settlement and FX entry',
    () =>
      Effect.gen(function* () {
        const source = yield* parseTricountApiResponse(
          MKD_PAYLOAD,
          'https://tricount.com/tLakeHouse2025XyZ012',
        )
        expect(source.provider).toBe('TRICOUNT')
        expect(source.name).toBe('Lake house 2025')
        expect(source.information).toBeNull()
        expect(source.currencyCode).toBe('MKD')
        expect(source.participants.map((p) => p.sourceName)).toEqual([
          'Alex',
          'Noor',
        ])
        expect(source.expenses).toHaveLength(5)

        const utilities = source.expenses.find(
          (e) => e.title === 'Utilities Dec',
        )!
        expect(utilities.splitMode).toBe('EVENLY')
        expect(utilities.amount).toBe(51100)
        expect(utilities.expenseDate).toBe('2025-12-30')

        // 3000/2000 reduces to the 3:2 weight ratio in fixed units.
        const groceries = source.expenses.find((e) => e.title === 'Groceries')!
        expect(groceries.splitMode).toBe('BY_SHARES')
        expect(
          groceries.paidFor.map((p) => p.shares).sort((a, b) => a - b),
        ).toEqual([200, 300])

        // Reversed allocation order resolves the same 3:2 weights.
        const fee = source.expenses.find((e) => e.title === 'Booking fee')!
        expect(fee.splitMode).toBe('BY_SHARES')
        expect(fee.paidFor.map((p) => p.shares).sort((a, b) => a - b)).toEqual([
          200, 300,
        ])

        // BALANCE row with a 0.00 payer self-allocation becomes a settlement
        // payer -> receiver (Noor paid, Alex receives).
        const reimbursement = source.expenses.find(
          (e) => e.title === 'Reimbursement',
        )!
        expect(reimbursement.category).toBe('settlement')
        expect(reimbursement.splitMode).toBe('EVENLY')
        expect(reimbursement.amount).toBe(8053251)
        expect(reimbursement.paidBy).toEqual([
          { sourceId: 'tricount-member-1', shares: 8053251 },
        ])
        expect(reimbursement.paidFor).toEqual([
          { sourceId: 'tricount-member-0', shares: 8053251 },
        ])

        // EUR-spent, MKD-booked entry keeps the booked amount in MKD, the
        // historical rate, and BY_AMOUNT (cent rounding breaks the 6:4 ratio).
        const guests = source.expenses.find(
          (e) => e.title === 'Guest apartments Jul',
        )!
        expect(guests.amountCurrency).toBe('MKD')
        expect(guests.amount).toBe(3614128)
        expect(guests.originalAmount).toBeNull()
        expect(guests.originalCurrency).toBeNull()
        expect(guests.conversionRate).toBeCloseTo(61.56946718730453, 10)
        expect(guests.splitMode).toBe('BY_AMOUNT')
      }),
    { timeout: 10000 },
  )
})

describe('extractTricountToken', () => {
  it('accepts bare tokens and share links', () => {
    expect(extractTricountToken('tMjbqgwJxaikhUbkNz')).toBe(
      'tMjbqgwJxaikhUbkNz',
    )
    expect(
      extractTricountToken('https://tricount.com/tMjbqgwJxaikhUbkNz'),
    ).toBe('tMjbqgwJxaikhUbkNz')
    expect(extractTricountToken('https://example.com/tABC')).toBeNull()
    expect(extractTricountToken('not a token')).toBeNull()
  })
})
