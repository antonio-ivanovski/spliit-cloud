import {
  decomposeCalculatorExpression,
  evaluateCalculatorExpression,
  formatCalculatorAmount,
} from './calculator'
import type { Currency } from './currency'

const currency: Currency = {
  code: 'USD',
  symbol: '$',
  rounding: 0,
  decimal_digits: 2,
}

describe('evaluateCalculatorExpression', () => {
  it.each([
    ['1+2*3', 7],
    ['(1+2)*3', 9],
    ['10/4', 2.5],
    ['-5+3', -2],
    ['2*-3', -6],
    ['2×3+1', 7],
    ['10÷4', 2.5],
    ['1+2*3+4', 11],
    ['10-5-2', 3],
    ['10/2/2', 2.5],
    ['1+(2*3)', 7],
    ['--5', 5],
    ['+-5', -5],
    ['1++2', 3],
    ['-2*3', -6],
    ['0+5', 5],
  ])('evaluates %s', (input, expected) => {
    expect(evaluateCalculatorExpression(input)).toEqual({
      ok: true,
      value: expected,
    })
  })

  it.each([
    '',
    '   ',
    '.',
    '()',
    '1+',
    '10/0',
    '((1))',
    '(1)+(2)',
    '(1+2',
    '1+2)',
    '1..2',
    '$10',
    '1+2a',
    '1e-10',
  ])('rejects invalid input %s', (input) => {
    expect(evaluateCalculatorExpression(input)).toEqual({ ok: false })
  })
})

describe('decomposeCalculatorExpression', () => {
  it.each([
    ['12', [{ quantity: 1, unitPrice: 12 }]],
    ['3*12', [{ quantity: 3, unitPrice: 12 }]],
    ['12*3', [{ quantity: 3, unitPrice: 12 }]],
    ['2.5*4', [{ quantity: 4, unitPrice: 2.5 }]],
    ['2.5*3.5', [{ quantity: 1, unitPrice: 8.75 }]],
    ['2*3*4', [{ quantity: 2, unitPrice: 12 }]],
    ['0.5*10*3', [{ quantity: 3, unitPrice: 5 }]],
    [
      '12+8',
      [
        { quantity: 1, unitPrice: 12 },
        { quantity: 1, unitPrice: 8 },
      ],
    ],
    [
      '3*12+2*5',
      [
        { quantity: 3, unitPrice: 12 },
        { quantity: 2, unitPrice: 5 },
      ],
    ],
    [
      '3*(12+8)',
      [
        { quantity: 3, unitPrice: 12 },
        { quantity: 3, unitPrice: 8 },
      ],
    ],
    [
      '(12+8)*3',
      [
        { quantity: 3, unitPrice: 12 },
        { quantity: 3, unitPrice: 8 },
      ],
    ],
    [
      '3*(12+8*2)',
      [
        { quantity: 3, unitPrice: 12 },
        { quantity: 6, unitPrice: 8 },
      ],
    ],
    [
      '10+20+30',
      [
        { quantity: 1, unitPrice: 10 },
        { quantity: 1, unitPrice: 20 },
        { quantity: 1, unitPrice: 30 },
      ],
    ],
    [
      '(10+20)',
      [
        { quantity: 1, unitPrice: 10 },
        { quantity: 1, unitPrice: 20 },
      ],
    ],
    [
      '0.5*4*(3+2)',
      [
        { quantity: 2, unitPrice: 3 },
        { quantity: 2, unitPrice: 2 },
      ],
    ],
  ])('decomposes %s', (input, items) => {
    expect(decomposeCalculatorExpression(input)).toEqual({ ok: true, items })
  })

  it.each([
    '0',
    '3+0',
    '10-2',
    '10-2+3',
    '10/2',
    '10*2/5',
    '-5',
    '-5+3',
    '2.5*(12+8)',
    '(1+2)*(3+4)',
  ])('rejects non-itemizable input %s', (input) => {
    expect(decomposeCalculatorExpression(input)).toEqual({ ok: false })
  })
})

describe('formatCalculatorAmount', () => {
  it('rounds away floating point noise to the currency precision', () => {
    expect(formatCalculatorAmount(0.1 + 0.2, currency)).toBe('0.3')
    expect(formatCalculatorAmount(1.005, currency)).toBe('1.01')
    expect(formatCalculatorAmount(0, currency)).toBe('0')
    expect(formatCalculatorAmount(-5, currency)).toBe('-5')
  })

  it('supports zero-decimal currencies', () => {
    expect(
      formatCalculatorAmount(123.7, {
        code: 'JPY',
        symbol: '¥',
        rounding: 0,
        decimal_digits: 0,
      }),
    ).toBe('124')
  })
})
