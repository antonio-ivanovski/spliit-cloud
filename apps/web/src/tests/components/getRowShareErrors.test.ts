import { describe, expect, it } from 'vitest'

import { getRowShareErrors } from '@/app/groups/[groupId]/expenses/expense-form/get-row-share-errors'

describe('getRowShareErrors', () => {
  it('returns no errors for EVENLY / ITEMIZED modes', () => {
    expect(
      getRowShareErrors({
        rows: [{ participant: 'a', shares: 0 }],
        splitMode: 'EVENLY',
        amount: 10,
      }),
    ).toEqual([])
    expect(
      getRowShareErrors({
        rows: [{ participant: 'a', shares: 0 }],
        splitMode: 'ITEMIZED',
        amount: 10,
      }),
    ).toEqual([])
  })

  it('returns no errors while the amount itself is zero', () => {
    expect(
      getRowShareErrors({
        rows: [{ participant: 'a', shares: 0 }],
        splitMode: 'BY_AMOUNT',
        amount: 0,
      }),
    ).toEqual([])
  })

  it('flags zero shares as noZeroShares in BY_AMOUNT', () => {
    expect(
      getRowShareErrors({
        rows: [
          { participant: 'a', shares: 10 },
          { participant: 'b', shares: 0 },
        ],
        splitMode: 'BY_AMOUNT',
        amount: 10,
      }),
    ).toEqual([{ index: 1, participantId: 'b', messageKey: 'noZeroShares' }])
  })

  it('flags negative shares as noZeroShares unless allowNegative', () => {
    const rows = [{ participant: 'a', shares: -5 }]
    expect(
      getRowShareErrors({ rows, splitMode: 'BY_PERCENTAGE', amount: 10 }),
    ).toEqual([{ index: 0, participantId: 'a', messageKey: 'noZeroShares' }])
    expect(
      getRowShareErrors({
        rows,
        splitMode: 'BY_PERCENTAGE',
        amount: 10,
        allowNegative: true,
      }),
    ).toEqual([])
  })

  it('flags out-of-range or fractional BY_SHARES as sharesInvalid', () => {
    expect(
      getRowShareErrors({
        rows: [{ participant: 'a', shares: 1.001 }],
        splitMode: 'BY_SHARES',
        amount: 10,
      }),
    ).toEqual([{ index: 0, participantId: 'a', messageKey: 'sharesInvalid' }])
    expect(
      getRowShareErrors({
        rows: [{ participant: 'a', shares: 0 }],
        splitMode: 'BY_SHARES',
        amount: 10,
      }),
    ).toEqual([{ index: 0, participantId: 'a', messageKey: 'sharesInvalid' }])
  })

  it('accepts valid decimal shares', () => {
    expect(
      getRowShareErrors({
        rows: [
          { participant: 'a', shares: 0.5 },
          { participant: 'b', shares: '1.25' },
        ],
        splitMode: 'BY_SHARES',
        amount: 10,
      }),
    ).toEqual([])
  })

  it('treats in-progress raw strings as their numeric value', () => {
    expect(
      getRowShareErrors({
        rows: [{ participant: 'a', shares: '0.' }],
        splitMode: 'BY_AMOUNT',
        amount: 10,
      }),
    ).toEqual([{ index: 0, participantId: 'a', messageKey: 'noZeroShares' }])
    expect(
      getRowShareErrors({
        rows: [{ participant: 'a', shares: '10.' }],
        splitMode: 'BY_AMOUNT',
        amount: 10,
      }),
    ).toEqual([])
  })

  it('flags NaN shares (partial inputs like "-") as invalidNumber', () => {
    expect(
      getRowShareErrors({
        rows: [{ participant: 'a', shares: '-' }],
        splitMode: 'BY_AMOUNT',
        amount: 10,
      }),
    ).toEqual([{ index: 0, participantId: 'a', messageKey: 'invalidNumber' }])
    expect(
      getRowShareErrors({
        rows: [{ participant: 'a', shares: '-' }],
        splitMode: 'BY_PERCENTAGE',
        amount: 10,
      }),
    ).toEqual([{ index: 0, participantId: 'a', messageKey: 'invalidNumber' }])
  })

  it('flags non-finite shares (Infinity from a long pasted string) as invalidNumber', () => {
    expect(
      getRowShareErrors({
        rows: [{ participant: 'a', shares: '1e400' }],
        splitMode: 'BY_AMOUNT',
        amount: 10,
      }),
    ).toEqual([{ index: 0, participantId: 'a', messageKey: 'invalidNumber' }])
    expect(
      getRowShareErrors({
        rows: [{ participant: 'a', shares: '-1e400' }],
        splitMode: 'BY_PERCENTAGE',
        amount: 10,
      }),
    ).toEqual([{ index: 0, participantId: 'a', messageKey: 'invalidNumber' }])
  })
})
