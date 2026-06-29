import { describe, expect, it } from 'vitest'
import {
  convertParticipantShares,
  gcd,
  type ParticipantRow,
  roundTo,
} from './split-mode-conversions'

function row(participant: string, shares: number): ParticipantRow {
  return { participant, shares }
}

describe('roundTo', () => {
  it('rounds half-up to 0 decimals', () => {
    expect(roundTo(3.5, 0)).toBe(4)
    expect(roundTo(3.4, 0)).toBe(3)
  })

  it('rounds half-up to 2 decimals', () => {
    expect(roundTo(3.33333, 2)).toBe(3.33)
    expect(roundTo(3.335, 2)).toBe(3.34)
  })
})

describe('gcd', () => {
  it('computes gcd of two positive integers', () => {
    expect(gcd(12, 8)).toBe(4)
    expect(gcd(25, 75)).toBe(25)
    expect(gcd(7, 13)).toBe(1)
  })

  it('returns 1 when either argument is 0', () => {
    expect(gcd(0, 5)).toBe(1)
    expect(gcd(5, 0)).toBe(1)
  })
})

// ── Same mode passthrough ──────────────────────────────────────────────

describe('same mode passthrough', () => {
  it('returns shallow clone when fromMode === toMode', () => {
    const rows = [row('a', 10), row('b', 20)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'BY_AMOUNT',
      toMode: 'BY_AMOUNT',
      targetAmount: 30,
    })
    expect(result).toEqual(rows)
    expect(result).not.toBe(rows)
    expect(result[0]).not.toBe(rows[0])
  })

  it('passes through EVENLY → EVENLY', () => {
    const rows = [row('a', 0), row('b', 0)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'EVENLY',
      toMode: 'EVENLY',
      targetAmount: 100,
    })
    expect(result).toEqual(rows)
  })
})

// ── EVENLY → * ─────────────────────────────────────────────────────────

describe('EVENLY → BY_SHARES', () => {
  it('distributes 1 share to each selected row', () => {
    const rows = [row('a', 1), row('b', 1), row('c', 1)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'EVENLY',
      toMode: 'BY_SHARES',
      targetAmount: 100,
    })
    expect(result.map((r) => r.shares)).toEqual([1, 1, 1])
  })

  it('preserves unselected rows', () => {
    const rows = [row('a', 1), row('b', 0), row('c', 1)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'EVENLY',
      toMode: 'BY_SHARES',
      targetAmount: 100,
    })
    expect(result[0].shares).toBe(1)
    expect(result[1].shares).toBe(0)
    expect(result[2].shares).toBe(1)
  })
})

describe('EVENLY → BY_PERCENTAGE', () => {
  it('distributes 100% evenly with drift correction (3-way)', () => {
    const rows = [row('a', 1), row('b', 1), row('c', 1)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'EVENLY',
      toMode: 'BY_PERCENTAGE',
      targetAmount: 100,
    })
    expect(result.map((r) => r.shares)).toEqual([33.33, 33.33, 33.34])
    const sum = result.reduce((s, r) => s + r.shares, 0)
    expect(sum).toBe(100)
  })

  it('distributes 100% evenly with 2 participants', () => {
    const rows = [row('a', 1), row('b', 1)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'EVENLY',
      toMode: 'BY_PERCENTAGE',
      targetAmount: 100,
    })
    expect(result.map((r) => r.shares)).toEqual([50, 50])
    const sum = result.reduce((s, r) => s + r.shares, 0)
    expect(sum).toBe(100)
  })
})

describe('EVENLY → BY_AMOUNT', () => {
  it('distributes targetAmount evenly with drift correction (3-way of 10)', () => {
    const rows = [row('a', 1), row('b', 1), row('c', 1)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'EVENLY',
      toMode: 'BY_AMOUNT',
      targetAmount: 10,
    })
    expect(result.map((r) => r.shares)).toEqual([3.33, 3.33, 3.34])
    const sum = result.reduce((s, r) => s + r.shares, 0)
    expect(sum).toBe(10)
  })

  it('distributes evenly with 2 participants (no drift)', () => {
    const rows = [row('a', 1), row('b', 1)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'EVENLY',
      toMode: 'BY_AMOUNT',
      targetAmount: 10,
    })
    expect(result.map((r) => r.shares)).toEqual([5, 5])
  })

  it('handles decimal_digits=0 (JPY)', () => {
    const rows = [row('a', 1), row('b', 1)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'EVENLY',
      toMode: 'BY_AMOUNT',
      targetAmount: 100,
      currency: { decimal_digits: 0 },
    })
    expect(result.map((r) => r.shares)).toEqual([50, 50])
  })
})

// ── BY_SHARES → * ──────────────────────────────────────────────────────

describe('BY_SHARES → BY_PERCENTAGE', () => {
  it('converts shares [1, 2, 3] to percentages summing to 100', () => {
    const rows = [row('a', 1), row('b', 2), row('c', 3)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'BY_SHARES',
      toMode: 'BY_PERCENTAGE',
      targetAmount: 100,
    })
    expect(result.map((r) => r.shares)).toEqual([16.67, 33.33, 50])
    const sum = result.reduce((s, r) => s + r.shares, 0)
    expect(sum).toBe(100)
  })

  it('converts [1, 1] to [50, 50]', () => {
    const rows = [row('a', 1), row('b', 1)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'BY_SHARES',
      toMode: 'BY_PERCENTAGE',
      targetAmount: 100,
    })
    expect(result.map((r) => r.shares)).toEqual([50, 50])
  })
})

describe('BY_SHARES → BY_AMOUNT', () => {
  it('distributes target by share ratio [1, 2, 3] with target 60', () => {
    const rows = [row('a', 1), row('b', 2), row('c', 3)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'BY_SHARES',
      toMode: 'BY_AMOUNT',
      targetAmount: 60,
    })
    // 60 * 1/6 = 10, 60 * 2/6 = 20, 60 * 3/6 = 30
    expect(result.map((r) => r.shares)).toEqual([10, 20, 30])
    const sum = result.reduce((s, r) => s + r.shares, 0)
    expect(sum).toBe(60)
  })

  it('adjusts last row to hit target when rounding causes drift', () => {
    // 3-way split of 10 with shares [1, 1, 1]
    // 10 * 1/3 = 3.33... rounds to 3.33 each
    // sum = 9.99, diff = 0.01 → last gets 3.34
    const rows = [row('a', 1), row('b', 1), row('c', 1)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'BY_SHARES',
      toMode: 'BY_AMOUNT',
      targetAmount: 10,
    })
    expect(result.map((r) => r.shares)).toEqual([3.33, 3.33, 3.34])
    const sum = result.reduce((s, r) => s + r.shares, 0)
    expect(sum).toBe(10)
  })
})

// ── BY_PERCENTAGE → * ──────────────────────────────────────────────────

describe('BY_PERCENTAGE → BY_SHARES', () => {
  it('converts [25, 75] to [1, 3] via GCD reduction', () => {
    const rows = [row('a', 25), row('b', 75)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'BY_PERCENTAGE',
      toMode: 'BY_SHARES',
      targetAmount: 100,
    })
    expect(result.map((r) => r.shares)).toEqual([1, 3])
  })

  it('converts [20, 40] to [1, 2] via GCD reduction', () => {
    const rows = [row('a', 20), row('b', 40)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'BY_PERCENTAGE',
      toMode: 'BY_SHARES',
      targetAmount: 100,
    })
    expect(result.map((r) => r.shares)).toEqual([1, 2])
  })

  it('outputs integers', () => {
    const rows = [row('a', 33.33), row('b', 33.33), row('c', 33.34)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'BY_PERCENTAGE',
      toMode: 'BY_SHARES',
      targetAmount: 100,
    })
    result.forEach((r) => {
      expect(Number.isInteger(r.shares)).toBe(true)
    })
  })
})

describe('BY_PERCENTAGE → BY_AMOUNT', () => {
  it('converts [25, 75] of target 200 to [50, 150]', () => {
    const rows = [row('a', 25), row('b', 75)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'BY_PERCENTAGE',
      toMode: 'BY_AMOUNT',
      targetAmount: 200,
    })
    expect(result.map((r) => r.shares)).toEqual([50, 150])
    const sum = result.reduce((s, r) => s + r.shares, 0)
    expect(sum).toBe(200)
  })

  it('adjusts last row when rounding causes drift (3-way)', () => {
    const rows = [row('a', 33.33), row('b', 33.33), row('c', 33.34)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'BY_PERCENTAGE',
      toMode: 'BY_AMOUNT',
      targetAmount: 100,
    })
    const sum = result.reduce((s, r) => s + r.shares, 0)
    expect(roundTo(sum, 2)).toBe(100)
  })
})

// ── BY_AMOUNT → * ──────────────────────────────────────────────────────

describe('BY_AMOUNT → BY_PERCENTAGE', () => {
  it('converts amounts [10, 20, 30] to percentages summing to 100', () => {
    const rows = [row('a', 10), row('b', 20), row('c', 30)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'BY_AMOUNT',
      toMode: 'BY_PERCENTAGE',
      targetAmount: 60,
    })
    expect(result.map((r) => r.shares)).toEqual([16.67, 33.33, 50])
    const sum = result.reduce((s, r) => s + r.shares, 0)
    expect(sum).toBe(100)
  })

  it('single selected row gets 100%', () => {
    const rows = [row('a', 50), row('b', 0)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'BY_AMOUNT',
      toMode: 'BY_PERCENTAGE',
      targetAmount: 50,
    })
    expect(result[0].shares).toBe(100)
    expect(result[1].shares).toBe(0)
  })
})

describe('BY_AMOUNT → BY_SHARES', () => {
  it('converts amounts to GCD-reduced integer weights', () => {
    const rows = [row('a', 12.34), row('b', 24.68)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'BY_AMOUNT',
      toMode: 'BY_SHARES',
      targetAmount: 37.02,
    })
    // 12.34 * 100 = 1234, 24.68 * 100 = 2468
    // gcd(1234, 2468) = 1234
    // 1234 / 1234 = 1, 2468 / 1234 = 2
    expect(result.map((r) => r.shares)).toEqual([1, 2])
  })

  it('outputs integers', () => {
    const rows = [row('a', 10), row('b', 20), row('c', 30)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'BY_AMOUNT',
      toMode: 'BY_SHARES',
      targetAmount: 60,
    })
    result.forEach((r) => {
      expect(Number.isInteger(r.shares)).toBe(true)
    })
  })
})

// ── Unselected rows ─────────────────────────────────────────────────────

describe('unselected rows', () => {
  it('preserve unselected rows with 0 in BY_SHARES mode', () => {
    const rows = [row('a', 1), row('b', 0), row('c', 0)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'EVENLY',
      toMode: 'BY_SHARES',
      targetAmount: 100,
    })
    expect(result[1].shares).toBe(0)
    expect(result[2].shares).toBe(0)
  })

  it('preserve unselected rows with 0 in BY_AMOUNT mode', () => {
    const rows = [row('a', 1), row('b', 0), row('c', 0)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'EVENLY',
      toMode: 'BY_AMOUNT',
      targetAmount: 10,
    })
    expect(result[1].shares).toBe(0)
    expect(result[2].shares).toBe(0)
  })

  it('conversion from BY_AMOUNT preserves unselected in BY_PERCENTAGE mode', () => {
    const rows = [row('a', 10), row('b', 0), row('c', 20)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'BY_AMOUNT',
      toMode: 'BY_PERCENTAGE',
      targetAmount: 30,
    })
    expect(result[1].shares).toBe(0)
    expect(result[0].shares + result[2].shares).toBeCloseTo(100, 0)
  })
})

// ── Single selected row ─────────────────────────────────────────────────

describe('single selected row', () => {
  it('gets full 100% when converting to BY_PERCENTAGE', () => {
    const rows = [row('a', 100), row('b', 0)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'BY_AMOUNT',
      toMode: 'BY_PERCENTAGE',
      targetAmount: 100,
    })
    expect(result[0].shares).toBe(100)
  })

  it('gets full targetAmount when converting to BY_AMOUNT', () => {
    const rows = [row('a', 1), row('b', 0)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'EVENLY',
      toMode: 'BY_AMOUNT',
      targetAmount: 50,
    })
    expect(result[0].shares).toBe(50)
  })

  it('gets single share when converting to BY_SHARES', () => {
    const rows = [row('a', 1), row('b', 0)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'EVENLY',
      toMode: 'BY_SHARES',
      targetAmount: 100,
    })
    expect(result[0].shares).toBe(1)
  })
})

// ── Empty selection ─────────────────────────────────────────────────────

describe('empty selection', () => {
  it('returns rows with zeros when no rows selected', () => {
    const rows = [row('a', 0), row('b', 0)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'EVENLY',
      toMode: 'BY_AMOUNT',
      targetAmount: 100,
    })
    expect(result.map((r) => r.shares)).toEqual([0, 0])
  })

  it('returns rows with 0 for non-BY_AMOUNT modes', () => {
    const rows = [row('a', 0), row('b', 0)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'EVENLY',
      toMode: 'BY_SHARES',
      targetAmount: 100,
    })
    expect(result.map((r) => r.shares)).toEqual([0, 0])
  })
})

// ── Output shape: BY_SHARES always integer ──────────────────────────────

describe('BY_SHARES output is always integer', () => {
  const fromModes: Array<{
    from: 'EVENLY' | 'BY_PERCENTAGE' | 'BY_AMOUNT'
    rows: ParticipantRow[]
  }> = [
    { from: 'EVENLY', rows: [row('a', 1), row('b', 1)] },
    { from: 'BY_PERCENTAGE', rows: [row('a', 50), row('b', 50)] },
    { from: 'BY_AMOUNT', rows: [row('a', 10), row('b', 20)] },
  ]
  for (const { from, rows } of fromModes) {
    it(`from ${from}`, () => {
      const result = convertParticipantShares({
        rows,
        fromMode: from,
        toMode: 'BY_SHARES',
        targetAmount: 30,
      })
      result.forEach((r) => {
        if (r.shares !== 0) {
          expect(Number.isInteger(r.shares)).toBe(true)
        }
      })
    })
  }
})

// ── BY_PERCENTAGE always sums to 100 ────────────────────────────────────

describe('BY_PERCENTAGE always sums to 100', () => {
  const cases: Array<{
    from: 'EVENLY' | 'BY_SHARES' | 'BY_AMOUNT'
    rows: ParticipantRow[]
  }> = [
    { from: 'EVENLY', rows: [row('a', 1), row('b', 1), row('c', 1)] },
    { from: 'BY_SHARES', rows: [row('a', 2), row('b', 3), row('c', 5)] },
    {
      from: 'BY_AMOUNT',
      rows: [row('a', 10), row('b', 20), row('c', 30)],
    },
  ]
  for (const { from, rows } of cases) {
    it(`from ${from}`, () => {
      const result = convertParticipantShares({
        rows,
        fromMode: from,
        toMode: 'BY_PERCENTAGE',
        targetAmount: 60,
      })
      const sum = result.reduce((s, r) => s + r.shares, 0)
      expect(roundTo(sum, 2)).toBe(100)
    })
  }
})

// ── BY_AMOUNT sums to target within precision ───────────────────────────

describe('BY_AMOUNT sums to target within precision', () => {
  it('decimal_digits = 0 (JPY)', () => {
    const rows = [row('a', 1), row('b', 1), row('c', 1)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'EVENLY',
      toMode: 'BY_AMOUNT',
      targetAmount: 100,
      currency: { decimal_digits: 0 },
    })
    const sum = result.reduce((s, r) => s + r.shares, 0)
    expect(sum).toBe(100)
  })

  it('decimal_digits = 2 (default)', () => {
    const rows = [row('a', 1), row('b', 1), row('c', 1)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'EVENLY',
      toMode: 'BY_AMOUNT',
      targetAmount: 10,
    })
    const sum = result.reduce((s, r) => s + r.shares, 0)
    expect(sum).toBe(10)
  })

  it('decimal_digits = 3', () => {
    const rows = [row('a', 1), row('b', 1), row('c', 1)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'EVENLY',
      toMode: 'BY_AMOUNT',
      targetAmount: 10,
      currency: { decimal_digits: 3 },
    })
    const sum = result.reduce((s, r) => s + r.shares, 0)
    expect(sum).toBe(10)
  })
})

// ── Currency default ────────────────────────────────────────────────────

describe('currency default', () => {
  it('defaults to decimal_digits = 2 when currency omitted', () => {
    const rows = [row('a', 1), row('b', 1)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'EVENLY',
      toMode: 'BY_AMOUNT',
      targetAmount: 10,
    })
    expect(result.map((r) => r.shares)).toEqual([5, 5])
  })
})

// ── Rounding drift extras ───────────────────────────────────────────────

describe('rounding drift', () => {
  it('3-way split of 10 into BY_AMOUNT: 3.34, 3.33, 3.33', () => {
    const rows = [row('a', 1), row('b', 1), row('c', 1)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'EVENLY',
      toMode: 'BY_AMOUNT',
      targetAmount: 10,
    })
    expect(result.map((r) => r.shares)).toEqual([3.33, 3.33, 3.34])
    const sum = result.reduce((s, r) => s + r.shares, 0)
    expect(sum).toBe(10)
  })

  it('3-way split 100 into BY_PERCENTAGE: 33.33, 33.33, 33.34', () => {
    const rows = [row('a', 1), row('b', 1), row('c', 1)]
    const result = convertParticipantShares({
      rows,
      fromMode: 'EVENLY',
      toMode: 'BY_PERCENTAGE',
      targetAmount: 100,
    })
    expect(result.map((r) => r.shares)).toEqual([33.33, 33.33, 33.34])
    const sum = result.reduce((s, r) => s + r.shares, 0)
    expect(sum).toBe(100)
  })
})

// ── Coverage for all 10 mode pairs ──────────────────────────────────────

describe('all mode pairs', () => {
  it('covers EVENLY→BY_AMOUNT', () => {
    const r = convertParticipantShares({
      rows: [row('a', 1)],
      fromMode: 'EVENLY',
      toMode: 'BY_AMOUNT',
      targetAmount: 100,
    })
    expect(r[0].shares).toBe(100)
  })

  it('covers EVENLY→BY_SHARES', () => {
    const r = convertParticipantShares({
      rows: [row('a', 1)],
      fromMode: 'EVENLY',
      toMode: 'BY_SHARES',
      targetAmount: 100,
    })
    expect(r[0].shares).toBe(1)
  })

  it('covers EVENLY→BY_PERCENTAGE', () => {
    const r = convertParticipantShares({
      rows: [row('a', 1)],
      fromMode: 'EVENLY',
      toMode: 'BY_PERCENTAGE',
      targetAmount: 100,
    })
    expect(r[0].shares).toBe(100)
  })

  it('covers BY_SHARES→BY_AMOUNT', () => {
    const r = convertParticipantShares({
      rows: [row('a', 3)],
      fromMode: 'BY_SHARES',
      toMode: 'BY_AMOUNT',
      targetAmount: 60,
    })
    expect(r[0].shares).toBe(60)
  })

  it('covers BY_SHARES→BY_PERCENTAGE', () => {
    const r = convertParticipantShares({
      rows: [row('a', 2)],
      fromMode: 'BY_SHARES',
      toMode: 'BY_PERCENTAGE',
      targetAmount: 100,
    })
    expect(r[0].shares).toBe(100)
  })

  it('covers BY_PERCENTAGE→BY_SHARES', () => {
    const r = convertParticipantShares({
      rows: [row('a', 100)],
      fromMode: 'BY_PERCENTAGE',
      toMode: 'BY_SHARES',
      targetAmount: 100,
    })
    expect(r[0].shares).toBe(1)
  })

  it('covers BY_PERCENTAGE→BY_AMOUNT', () => {
    const r = convertParticipantShares({
      rows: [row('a', 50)],
      fromMode: 'BY_PERCENTAGE',
      toMode: 'BY_AMOUNT',
      targetAmount: 200,
    })
    // Single row absorbs full target via drift correction
    expect(r[0].shares).toBe(200)
  })

  it('covers BY_AMOUNT→BY_PERCENTAGE', () => {
    const r = convertParticipantShares({
      rows: [row('a', 50)],
      fromMode: 'BY_AMOUNT',
      toMode: 'BY_PERCENTAGE',
      targetAmount: 50,
    })
    expect(r[0].shares).toBe(100)
  })

  it('covers BY_AMOUNT→BY_SHARES', () => {
    const r = convertParticipantShares({
      rows: [row('a', 50)],
      fromMode: 'BY_AMOUNT',
      toMode: 'BY_SHARES',
      targetAmount: 50,
    })
    expect(r[0].shares).toBe(1)
  })

  it('covers same-mode (BY_AMOUNT→BY_AMOUNT) passthrough', () => {
    const rows = [row('a', 50)]
    const r = convertParticipantShares({
      rows,
      fromMode: 'BY_AMOUNT',
      toMode: 'BY_AMOUNT',
      targetAmount: 50,
    })
    expect(r).toEqual(rows)
  })
})
