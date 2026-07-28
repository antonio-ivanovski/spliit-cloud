import { describe, expect, it } from 'vitest'

import {
  guessByShares,
  guessEvenly,
  guessSplitMode,
  type PaidForEntry,
} from './split-guess'

function pf(entries: [string, number][]): PaidForEntry[] {
  return entries.map(([sourceId, shares]) => ({ sourceId, shares }))
}

// ── guessEvenly ───────────────────────────────────────────────────────────

describe('guessEvenly', () => {
  it('returns EVENLY when all shares are identical (2 participants)', () => {
    expect(
      guessEvenly(
        pf([
          ['a', 50],
          ['b', 50],
        ]),
        100,
      ),
    ).toBe('EVENLY')
  })

  it('returns EVENLY when all shares are identical (4 participants)', () => {
    expect(
      guessEvenly(
        pf([
          ['a', 2500],
          ['b', 2500],
          ['c', 2500],
          ['d', 2500],
        ]),
        10000,
      ),
    ).toBe('EVENLY')
  })

  it('returns EVENLY for N=2 exactly-equal shares (int cents)', () => {
    expect(
      guessEvenly(
        pf([
          ['j', 2500],
          ['e', 2500],
        ]),
        5000,
      ),
    ).toBe('EVENLY')
  })

  it('returns null for a single participant', () => {
    expect(guessEvenly(pf([['a', 100]]), 100)).toBeNull()
  })

  it('returns null when shares differ by more than 0 cents (strict mode)', () => {
    // 9400 / 7 → shares differ by 1 cent
    expect(
      guessEvenly(
        pf([
          ['p0', 134286],
          ['p1', 134285],
          ['p2', 134286],
          ['p3', 134285],
          ['p4', 134286],
          ['p5', 134286],
          ['p6', 134286],
        ]),
        940000,
      ),
    ).toBeNull()
  })

  it('returns null for shares that are close but not equal (e.g. 33 / 33 / 34)', () => {
    expect(
      guessEvenly(
        pf([
          ['a', 33],
          ['b', 33],
          ['c', 34],
        ]),
        100,
      ),
    ).toBeNull()
  })

  // ── allowOneCentDrift ──────────────────────────────────────────────

  it('allowOneCentDrift: returns EVENLY when shares differ by at most 1 cent', () => {
    const result = guessEvenly(
      pf([
        ['p0', 134286],
        ['p1', 134285],
        ['p2', 134286],
      ]),
      402857,
      { allowOneCentDrift: true },
    )
    expect(result).toBe('EVENLY')
  })

  it('allowOneCentDrift: still returns null when shares differ by more than 1 cent', () => {
    const result = guessEvenly(
      pf([
        ['a', 100],
        ['b', 200],
      ]),
      300,
      { allowOneCentDrift: true },
    )
    expect(result).toBeNull()
  })

  it('allowOneCentDrift: returns EVENLY for a trivial 2-person drift-prone split', () => {
    // 100 / 3 → 33.33… → shares of [33, 33, 34] — with drift the 1-cent
    // tolerance treats these as EVENLY.
    const result = guessEvenly(
      pf([
        ['a', 33],
        ['b', 33],
        ['c', 34],
      ]),
      100,
      { allowOneCentDrift: true },
    )
    expect(result).toBe('EVENLY')
  })

  it('default (no config) is strict: identical only', () => {
    expect(
      guessEvenly(
        pf([
          ['a', 33],
          ['b', 33],
          ['c', 34],
        ]),
        100,
      ),
    ).toBeNull()
    expect(
      guessEvenly(
        pf([
          ['a', 33],
          ['b', 33],
          ['c', 34],
        ]),
        100,
        {},
      ),
    ).toBeNull()
  })

  // ── involvedParticipantCount ────────────────────────────────────────

  it('1-to-1 payment: single paidFor entry + 2 involved → EVENLY', () => {
    // Payer not in paidFor (consumed nothing), only receiver is listed.
    const result = guessEvenly(pf([['receiver', 5000]]), 5000, {
      involvedParticipantCount: 2,
    })
    expect(result).toBe('EVENLY')
  })

  it('1-to-1 payment: still null without the involved count hint', () => {
    const result = guessEvenly(pf([['receiver', 5000]]), 5000)
    expect(result).toBeNull()
  })

  it('1-to-1 payment: still null when involved count is 1 (solo expense)', () => {
    const result = guessEvenly(pf([['receiver', 5000]]), 5000, {
      involvedParticipantCount: 1,
    })
    expect(result).toBeNull()
  })
})

// ── guessByShares ─────────────────────────────────────────────────────────

describe('guessByShares', () => {
  it('returns normalised weights for 2:1 ratio (gcd=50)', () => {
    expect(
      guessByShares(
        pf([
          ['a', 100],
          ['b', 50],
        ]),
        150,
      ),
    ).toEqual(
      pf([
        ['a', 2],
        ['b', 1],
      ]),
    )
  })

  it('returns normalised weights for 3:2:1 ratio (gcd=33)', () => {
    expect(
      guessByShares(
        pf([
          ['a', 99],
          ['b', 66],
          ['c', 33],
        ]),
        198,
      ),
    ).toEqual(
      pf([
        ['a', 3],
        ['b', 2],
        ['c', 1],
      ]),
    )
  })

  it('returns normalised weights for 4:3:1 ratio (gcd=25)', () => {
    expect(
      guessByShares(
        pf([
          ['a', 100],
          ['b', 75],
          ['c', 25],
        ]),
        200,
      ),
    ).toEqual(
      pf([
        ['a', 4],
        ['b', 3],
        ['c', 1],
      ]),
    )
  })

  it('returns normalised weights for 3:2 with gcd=20', () => {
    expect(
      guessByShares(
        pf([
          ['a', 60],
          ['b', 40],
        ]),
        100,
      ),
    ).toEqual(
      pf([
        ['a', 3],
        ['b', 2],
      ]),
    )
  })

  it('returns null when GCD is 1 (no clean ratio)', () => {
    // 7:5 — clean conceptually, but gcd(7,5)=1
    expect(
      guessByShares(
        pf([
          ['a', 7],
          ['b', 5],
        ]),
        12,
      ),
    ).toBeNull()
  })

  it('returns null for a single participant', () => {
    expect(guessByShares(pf([['a', 100]]), 100)).toBeNull()
  })

  it('returns null for the typical 7-way drift-prone split (gcd=1)', () => {
    expect(
      guessByShares(
        pf([
          ['p0', 134286],
          ['p1', 134285],
          ['p2', 134286],
          ['p3', 134285],
          ['p4', 134286],
          ['p5', 134286],
          ['p6', 134286],
        ]),
        940000,
      ),
    ).toBeNull()
  })

  // ── maxWeight ──────────────────────────────────────────────────────

  it('maxWeight: returns normalised weights when weights are within the cap', () => {
    // GCD = 100 → weights [3, 2, 1], maxWeight = 3, well under default 25.
    const result = guessByShares(
      pf([
        ['a', 300],
        ['b', 200],
        ['c', 100],
      ]),
      600,
      { maxWeight: 25 },
    )
    expect(result).toEqual(
      pf([
        ['a', 3],
        ['b', 2],
        ['c', 1],
      ]),
    )
  })

  it('maxWeight: returns null when the largest normalized weight exceeds the cap', () => {
    // GCD = 1 → weights [56, 1], not a clean ratio.  But let's test a real
    // large-ratio case: [2800, 100] → GCD=100 → weights [28, 1], max=28.
    // With cap=25 this should be rejected.
    const result = guessByShares(
      pf([
        ['a', 2800],
        ['b', 100],
      ]),
      2900,
      { maxWeight: 25 },
    )
    expect(result).toBeNull()
  })

  it('maxWeight: same shares pass with a generous cap', () => {
    const result = guessByShares(
      pf([
        ['a', 2800],
        ['b', 100],
      ]),
      2900,
      { maxWeight: 30 },
    )
    expect(result).toEqual(
      pf([
        ['a', 28],
        ['b', 1],
      ]),
    )
  })

  it('default maxWeight is 25 (implicit)', () => {
    // GCD=50 → weights [24, 1], max=24 ≤ default 25 → passes.
    expect(
      guessByShares(
        pf([
          ['a', 1200],
          ['b', 50],
        ]),
        1250,
      ),
    ).toEqual(
      pf([
        ['a', 24],
        ['b', 1],
      ]),
    )
    // GCD=10 → weights [26, 1], max=26 > default 25 → null.
    expect(
      guessByShares(
        pf([
          ['a', 260],
          ['b', 10],
        ]),
        270,
      ),
    ).toBeNull()
  })

  it('maxWeight: clean ratio with large absolute cents but small weights still passes', () => {
    // Shares [200000, 100000] → GCD=100000 → weights [2, 1], max=2 ≤ 25.
    const result = guessByShares(
      pf([
        ['a', 200000],
        ['b', 100000],
      ]),
      300000,
      { maxWeight: 25 },
    )
    expect(result).toEqual(
      pf([
        ['a', 2],
        ['b', 1],
      ]),
    )
  })
})

// ── guessSplitMode (composite) ────────────────────────────────────────────

describe('guessSplitMode', () => {
  it('returns EVENLY when all shares are identical', () => {
    expect(
      guessSplitMode(
        pf([
          ['a', 50],
          ['b', 50],
        ]),
        100,
      ),
    ).toEqual({
      splitMode: 'EVENLY',
      paidFor: pf([
        ['a', 50],
        ['b', 50],
      ]),
    })
  })

  it('returns BY_SHARES for a clean integer ratio', () => {
    expect(
      guessSplitMode(
        pf([
          ['a', 100],
          ['b', 50],
        ]),
        150,
      ),
    ).toEqual({
      splitMode: 'BY_SHARES',
      paidFor: pf([
        ['a', 2],
        ['b', 1],
      ]),
    })
  })

  it('returns BY_AMOUNT for unequal shares with GCD=1', () => {
    expect(
      guessSplitMode(
        pf([
          ['a', 7],
          ['b', 5],
        ]),
        12,
      ),
    ).toEqual({
      splitMode: 'BY_AMOUNT',
      paidFor: pf([
        ['a', 7],
        ['b', 5],
      ]),
    })
  })

  it('returns BY_AMOUNT for drift-prone near-equal shares (strict EVENLY off)', () => {
    expect(
      guessSplitMode(
        pf([
          ['p0', 134286],
          ['p1', 134285],
          ['p2', 134286],
          ['p3', 134285],
          ['p4', 134286],
          ['p5', 134286],
          ['p6', 134286],
        ]),
        940000,
      ),
    ).toEqual({
      splitMode: 'BY_AMOUNT',
      paidFor: pf([
        ['p0', 134286],
        ['p1', 134285],
        ['p2', 134286],
        ['p3', 134285],
        ['p4', 134286],
        ['p5', 134286],
        ['p6', 134286],
      ]),
    })
  })

  it('returns BY_AMOUNT for empty paidFor', () => {
    expect(guessSplitMode([], 0)).toEqual({
      splitMode: 'BY_AMOUNT',
      paidFor: [],
    })
  })

  it('returns BY_AMOUNT for a single participant', () => {
    expect(guessSplitMode(pf([['a', 100]]), 100)).toEqual({
      splitMode: 'BY_AMOUNT',
      paidFor: pf([['a', 100]]),
    })
  })

  it('passes config through to inner guessers', () => {
    // Without drift: near-equal shares → BY_AMOUNT
    expect(
      guessSplitMode(
        pf([
          ['a', 33],
          ['b', 33],
          ['c', 34],
        ]),
        100,
      ),
    ).toEqual({
      splitMode: 'BY_AMOUNT',
      paidFor: pf([
        ['a', 33],
        ['b', 33],
        ['c', 34],
      ]),
    })
    // With drift: near-equal shares → EVENLY
    expect(
      guessSplitMode(
        pf([
          ['a', 33],
          ['b', 33],
          ['c', 34],
        ]),
        100,
        { allowOneCentDrift: true },
      ),
    ).toEqual({
      splitMode: 'EVENLY',
      paidFor: pf([
        ['a', 33],
        ['b', 33],
        ['c', 34],
      ]),
    })
  })

  it('detects 1-to-1 payment as EVENLY via involvedParticipantCount', () => {
    const result = guessSplitMode(pf([['receiver', 2500]]), 2500, {
      involvedParticipantCount: 2,
    })
    expect(result).toEqual({
      splitMode: 'EVENLY',
      paidFor: pf([['receiver', 2500]]),
    })
  })

  it('falls through to BY_AMOUNT for a solo expense even with involved hint', () => {
    const result = guessSplitMode(pf([['solo', 100]]), 100, {
      involvedParticipantCount: 1,
    })
    expect(result).toEqual({
      splitMode: 'BY_AMOUNT',
      paidFor: pf([['solo', 100]]),
    })
  })

  it('normalises [1152000, 768000] → BY_SHARES [3, 2] (reported bug)', () => {
    const result = guessSplitMode(
      pf([
        ['a', 1152000],
        ['b', 768000],
      ]),
      1920000,
    )
    expect(result).toEqual({
      splitMode: 'BY_SHARES',
      paidFor: pf([
        ['a', 3],
        ['b', 2],
      ]),
    })
  })

  it('normalises [200, 300] → BY_SHARES [2, 3] (reported bug)', () => {
    const result = guessSplitMode(
      pf([
        ['a', 200],
        ['b', 300],
      ]),
      500,
    )
    expect(result).toEqual({
      splitMode: 'BY_SHARES',
      paidFor: pf([
        ['a', 2],
        ['b', 3],
      ]),
    })
  })
})
