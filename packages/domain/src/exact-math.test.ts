import {
  addExactAmount,
  convertByRate,
  exactAmountToNumber,
  exactFromFraction,
  exactFromInteger,
  exactZero,
  gcd,
  isCrossCurrency,
  type ExactAmount,
} from './exact-math'

describe('gcd', () => {
  it('returns gcd of two positive integers', () => {
    expect(gcd(12n, 8n)).toBe(4n)
  })

  it('returns gcd including negative numbers', () => {
    expect(gcd(-12n, 8n)).toBe(4n)
  })

  it('handles zero: gcd(a, 0) = |a|', () => {
    expect(gcd(0n, 5n)).toBe(5n)
    expect(gcd(5n, 0n)).toBe(5n)
  })

  it('returns 1 for coprime numbers', () => {
    expect(gcd(7n, 13n)).toBe(1n)
  })
})

describe('exactFromFraction', () => {
  it('reduces fraction to lowest terms', () => {
    const result = exactFromFraction(200n, 100n)
    expect(result).toEqual({ numerator: 2n, denominator: 1n })
  })

  it('handles negative numerator', () => {
    const result = exactFromFraction(-100n, 200n)
    expect(result.numerator).toBe(-1n)
    expect(result.denominator).toBe(2n)
  })

  it('moves sign to numerator when denominator is negative', () => {
    const result = exactFromFraction(100n, -200n)
    expect(result.numerator).toBe(-1n)
    expect(result.denominator).toBe(2n)
  })

  it('returns zero for zero denominator', () => {
    const result = exactFromFraction(5n, 0n)
    expect(result).toEqual({ numerator: 0n, denominator: 1n })
  })
})

describe('exactZero', () => {
  it('returns 0/1', () => {
    expect(exactZero()).toEqual({ numerator: 0n, denominator: 1n })
  })
})

describe('exactFromInteger', () => {
  it('converts a number to ExactAmount with denominator 1', () => {
    expect(exactFromInteger(42)).toEqual({ numerator: 42n, denominator: 1n })
  })

  it('handles negative integers', () => {
    expect(exactFromInteger(-5)).toEqual({ numerator: -5n, denominator: 1n })
  })

  it('rounds display float residue before converting to BigInt', () => {
    expect(exactFromInteger(4029.9999999999995)).toEqual({
      numerator: 4030n,
      denominator: 1n,
    })
  })
})

describe('exactAmountToNumber', () => {
  it('converts ExactAmount to number', () => {
    expect(
      exactAmountToNumber({ numerator: 100n, denominator: 3n }),
    ).toBeCloseTo(33.333)
  })

  it('handles whole numbers', () => {
    expect(exactAmountToNumber({ numerator: 50n, denominator: 1n })).toBe(50)
  })
})

describe('addExactAmount', () => {
  it('adds two exact amounts with same denominator', () => {
    const a: ExactAmount = { numerator: 1n, denominator: 3n }
    const b: ExactAmount = { numerator: 1n, denominator: 3n }
    const result = addExactAmount(a, b)
    expect(result).toEqual({ numerator: 2n, denominator: 3n })
  })

  it('adds two exact amounts with different denominators', () => {
    const a: ExactAmount = { numerator: 1n, denominator: 3n }
    const b: ExactAmount = { numerator: 1n, denominator: 5n }
    const result = addExactAmount(a, b)
    // 1/3 + 1/5 = 8/15
    expect(result).toEqual({ numerator: 8n, denominator: 15n })
  })

  it('returns the non-zero operand when one is zero', () => {
    const a: ExactAmount = { numerator: 5n, denominator: 1n }
    const zero = exactZero()
    expect(addExactAmount(a, zero)).toEqual(a)
    expect(addExactAmount(zero, a)).toEqual(a)
  })

  it('handles negative values', () => {
    const a: ExactAmount = { numerator: -1n, denominator: 2n }
    const b: ExactAmount = { numerator: 3n, denominator: 4n }
    // -1/2 + 3/4 = (-2+3)/4 = 1/4
    const result = addExactAmount(a, b)
    expect(result).toEqual({ numerator: 1n, denominator: 4n })
  })
})

describe('convertByRate', () => {
  it('converts amount by rate and rounds to integer', () => {
    const amount: ExactAmount = { numerator: 7000n, denominator: 1n }
    const result = convertByRate(amount, 0.92)
    expect(result).toEqual({ numerator: 6440n, denominator: 1n })
  })

  it('handles string rates', () => {
    const amount: ExactAmount = { numerator: 1000n, denominator: 1n }
    const result = convertByRate(amount, '0.5')
    expect(result).toEqual({ numerator: 500n, denominator: 1n })
  })
})

describe('isCrossCurrency', () => {
  it('returns true when both originalCurrency and conversionRate are set', () => {
    expect(
      isCrossCurrency({
        originalCurrency: 'USD',
        conversionRate: 0.92,
      }),
    ).toBe(true)
  })

  it('returns false when only originalCurrency is set', () => {
    expect(
      isCrossCurrency({
        originalCurrency: 'USD',
        conversionRate: null,
      }),
    ).toBe(false)
  })

  it('returns false when neither is set', () => {
    expect(
      isCrossCurrency({
        originalCurrency: null,
        conversionRate: null,
      }),
    ).toBe(false)
  })
})
