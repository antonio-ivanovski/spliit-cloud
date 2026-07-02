import { describe, expect, it } from 'vitest'
import { payerSemantics, splitSemantics } from './semantics'
import type { ChangeContext } from './types'

const ctx: ChangeContext = {
  getParticipantName: (id) => {
    const names: Record<string, string> = {
      'lp-alice': 'Alice',
      'lp-bob': 'Bob',
      'lp-carol': 'Carol',
    }
    return names[id] ?? id
  },
  getCategoryName: (id) => id,
  formatCurrencyCents: (c, cur) => `${cur ?? 'EUR'} ${c / 100}`,
}

describe('payerSemantics', () => {
  describe('key', () => {
    it('BY_AMOUNT: ignores shares, compares only participant IDs', () => {
      const a = [{ participant: 'lp-alice', shares: 4500 }]
      const b = [{ participant: 'lp-alice', shares: 5000 }]
      expect(payerSemantics.key(a, 'BY_AMOUNT')).toBe(
        payerSemantics.key(b, 'BY_AMOUNT'),
      )
    })

    it('BY_AMOUNT: detects payer participant changes', () => {
      const a = [{ participant: 'lp-alice', shares: 4500 }]
      const b = [{ participant: 'lp-bob', shares: 4500 }]
      expect(payerSemantics.key(a, 'BY_AMOUNT')).not.toBe(
        payerSemantics.key(b, 'BY_AMOUNT'),
      )
    })

    it('BY_PERCENTAGE: compares participant+shares', () => {
      const old = [
        { participant: 'lp-alice', shares: 7000 },
        { participant: 'lp-bob', shares: 3000 },
      ]
      const upd = [
        { participant: 'lp-alice', shares: 5000 },
        { participant: 'lp-bob', shares: 5000 },
      ]
      expect(payerSemantics.key(old, 'BY_PERCENTAGE')).not.toBe(
        payerSemantics.key(upd, 'BY_PERCENTAGE'),
      )
    })

    it('BY_SHARES: compares participant+shares', () => {
      const a = [
        { participant: 'lp-alice', shares: 1 },
        { participant: 'lp-bob', shares: 1 },
      ]
      const b = [
        { participant: 'lp-alice', shares: 2 },
        { participant: 'lp-bob', shares: 1 },
      ]
      expect(payerSemantics.key(a, 'BY_SHARES')).not.toBe(
        payerSemantics.key(b, 'BY_SHARES'),
      )
    })

    it('is order-independent (sorted)', () => {
      const unord = [
        { participant: 'lp-bob', shares: 3000 },
        { participant: 'lp-alice', shares: 7000 },
      ]
      const ord = [
        { participant: 'lp-alice', shares: 7000 },
        { participant: 'lp-bob', shares: 3000 },
      ]
      expect(payerSemantics.key(unord, 'BY_PERCENTAGE')).toBe(
        payerSemantics.key(ord, 'BY_PERCENTAGE'),
      )
    })

    it('BY_AMOUNT multi-payer: compares only IDs', () => {
      const a = [
        { participant: 'lp-alice', shares: 3000 },
        { participant: 'lp-bob', shares: 1500 },
      ]
      const b = [
        { participant: 'lp-alice', shares: 4000 },
        { participant: 'lp-bob', shares: 2000 },
      ]
      expect(payerSemantics.key(a, 'BY_AMOUNT')).toBe(
        payerSemantics.key(b, 'BY_AMOUNT'),
      )
    })
  })

  describe('format', () => {
    it('joins participant names with commas', () => {
      expect(
        payerSemantics.format(
          [
            { participant: 'lp-alice', shares: 4500 },
            { participant: 'lp-bob', shares: 1500 },
          ],
          ctx,
        ),
      ).toBe('Alice, Bob')
    })

    it('returns empty string for empty rows', () => {
      expect(payerSemantics.format([], ctx)).toBe('')
    })
  })
})

describe('splitSemantics', () => {
  describe('paidForKey', () => {
    it('is order-independent', () => {
      const a = [
        { participant: 'lp-bob', shares: 1 },
        { participant: 'lp-alice', shares: 1 },
      ]
      const b = [
        { participant: 'lp-alice', shares: 1 },
        { participant: 'lp-bob', shares: 1 },
      ]
      expect(splitSemantics.paidForKey(a)).toBe(splitSemantics.paidForKey(b))
    })

    it('detects share differences', () => {
      expect(
        splitSemantics.paidForKey([{ participant: 'lp-alice', shares: 1 }]),
      ).not.toBe(
        splitSemantics.paidForKey([{ participant: 'lp-alice', shares: 2 }]),
      )
    })

    it('detects participant differences', () => {
      expect(
        splitSemantics.paidForKey([{ participant: 'lp-alice', shares: 1 }]),
      ).not.toBe(
        splitSemantics.paidForKey([{ participant: 'lp-bob', shares: 1 }]),
      )
    })
  })

  describe('remainderKey', () => {
    it('returns empty for undefined', () => {
      expect(splitSemantics.remainderKey(undefined)).toBe('')
    })

    it('includes splitMode and paidFor', () => {
      const r = {
        splitMode: 'EVENLY' as const,
        paidFor: [{ participant: 'lp-alice', shares: 1 }],
      }
      const key = splitSemantics.remainderKey(r)
      expect(key).toContain('EVENLY')
      expect(key).toContain('lp-alice')
    })

    it('differs when splitMode changes', () => {
      const k1 = splitSemantics.remainderKey({
        splitMode: 'EVENLY',
        paidFor: [],
      })
      const k2 = splitSemantics.remainderKey({
        splitMode: 'BY_PERCENTAGE',
        paidFor: [],
      })
      expect(k1).not.toBe(k2)
    })
  })

  describe('format', () => {
    it('formats EVENLY split', () => {
      expect(
        splitSemantics.format(
          'EVENLY',
          [
            { participant: 'lp-alice', shares: 1 },
            { participant: 'lp-bob', shares: 1 },
          ],
          ctx,
        ),
      ).toBe('Equal split: Alice, Bob')
    })

    it('formats BY_PERCENTAGE split', () => {
      expect(
        splitSemantics.format(
          'BY_PERCENTAGE',
          [
            { participant: 'lp-alice', shares: 7000 },
            { participant: 'lp-bob', shares: 3000 },
          ],
          ctx,
        ),
      ).toBe('Custom split: Alice 70%, Bob 30%')
    })

    it('formats BY_SHARES split', () => {
      expect(
        splitSemantics.format(
          'BY_SHARES',
          [
            { participant: 'lp-alice', shares: 2 },
            { participant: 'lp-bob', shares: 1 },
          ],
          ctx,
        ),
      ).toBe('Custom split: Alice 2, Bob 1')
    })
  })
})
