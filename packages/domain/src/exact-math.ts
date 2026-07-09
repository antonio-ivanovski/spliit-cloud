export type ExactAmount = {
  numerator: bigint
  denominator: bigint
}

export type ParticipantShare = {
  shares: number
}

export function isCrossCurrency(expense: {
  originalCurrency?: string | null
  conversionRate?: number | string | null
}): boolean {
  return Boolean(expense.originalCurrency && expense.conversionRate)
}

export const exactZero = (): ExactAmount => ({
  numerator: 0n,
  denominator: 1n,
})

export function exactFromInteger(amount: number): ExactAmount {
  return { numerator: BigInt(amount), denominator: 1n }
}

function bigintAbs(value: bigint): bigint {
  return value < 0n ? -value : value
}

export function gcd(a: bigint, b: bigint): bigint {
  a = bigintAbs(a)
  b = bigintAbs(b)
  while (b !== 0n) {
    const next = a % b
    a = b
    b = next
  }
  return a === 0n ? 1n : a
}

export function exactFromFraction(
  numerator: bigint,
  denominator: bigint,
): ExactAmount {
  if (denominator === 0n) return exactZero()
  if (denominator < 0n) {
    numerator = -numerator
    denominator = -denominator
  }
  const divisor = gcd(numerator, denominator)
  return { numerator: numerator / divisor, denominator: denominator / divisor }
}

export function exactAmountToNumber(amount: ExactAmount): number {
  return Number(amount.numerator) / Number(amount.denominator)
}

export function addExactAmount(a: ExactAmount, b: ExactAmount): ExactAmount {
  if (a.numerator === 0n) return b
  if (b.numerator === 0n) return a
  if (a.denominator === b.denominator) {
    return exactFromFraction(a.numerator + b.numerator, a.denominator)
  }
  return exactFromFraction(
    a.numerator * b.denominator + b.numerator * a.denominator,
    a.denominator * b.denominator,
  )
}

export function truncExactAmount(amount: ExactAmount): number {
  return Number(amount.numerator / amount.denominator)
}

export function fractionNumeratorAbs(
  amount: ExactAmount,
  truncated: number,
): bigint {
  const remainder = amount.numerator - BigInt(truncated) * amount.denominator
  return remainder < 0n ? -remainder : remainder
}

export function convertByRate(
  amount: ExactAmount,
  rate: number | string,
): ExactAmount {
  return exactFromInteger(
    Math.round(exactAmountToNumber(amount) * Number(rate)),
  )
}
