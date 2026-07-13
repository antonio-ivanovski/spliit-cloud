import { getCurrency } from '@/lib/currency'
import { describe, expect, it } from 'vitest'
import type { VisualSplitRow } from './types'
import {
  amountFromMinorUnits,
  buildAllocation,
  formatUnit,
  formValue,
  rowsSignature,
  unitValue,
} from './visual-split-utils'

const usd = getCurrency('USD')!

describe('visual-split-utils', () => {
  describe('amountFromMinorUnits', () => {
    it('divides by 10^decimal_digits', () => {
      expect(amountFromMinorUnits(1234, usd)).toBeCloseTo(12.34, 2)
    })
  })

  describe('unitValue', () => {
    it('converts percentages to basis points', () => {
      expect(unitValue('BY_PERCENTAGE', 25, usd)).toBe(2500)
    })

    it('converts amounts to minor units (absolute)', () => {
      expect(unitValue('BY_AMOUNT', -12.5, usd)).toBe(1250)
    })

    it('rounds share counts and enforces a minimum of 1', () => {
      expect(unitValue('BY_SHARES', 3, usd)).toBe(3)
      expect(unitValue('BY_SHARES', 0, usd)).toBe(1)
    })
  })

  describe('formValue', () => {
    it('converts basis points back to percentages', () => {
      expect(formValue('BY_PERCENTAGE', 2500, usd)).toBe(25)
    })

    it('converts minor units back to major amounts', () => {
      expect(formValue('BY_AMOUNT', 1234, usd)).toBeCloseTo(12.34, 2)
    })

    it('returns share counts unchanged', () => {
      expect(formValue('BY_SHARES', 7, usd)).toBe(7)
    })
  })

  describe('buildAllocation', () => {
    it('builds a percentage allocation with target 10000', () => {
      const rows: VisualSplitRow[] = [
        { participant: 'a', shares: 50 },
        { participant: 'b', shares: 50 },
      ]
      const allocation = buildAllocation('BY_PERCENTAGE', rows, 0, usd)
      expect(allocation?.target).toBe(10_000)
      expect(allocation?.entries.map((e) => e.value)).toEqual([5000, 5000])
    })

    it('returns null when the target amount rounds below the selected row count', () => {
      const rows: VisualSplitRow[] = [
        { participant: 'a', shares: 1 },
        { participant: 'b', shares: 1 },
        { participant: 'c', shares: 1 },
      ]
      expect(buildAllocation('BY_AMOUNT', rows, 0, usd)).toBeNull()
    })
  })

  describe('rowsSignature', () => {
    it('serializes rows as participant:shares joined by |', () => {
      const rows: VisualSplitRow[] = [
        { participant: 'a', shares: 1 },
        { participant: 'b', shares: 2.5 },
      ]
      expect(rowsSignature(rows)).toBe('a:1|b:2.5')
    })
  })

  describe('formatUnit', () => {
    it('formats percentages, hiding trailing zeros', () => {
      expect(formatUnit('BY_PERCENTAGE', 5000, usd, 'en-US', 'shares')).toBe(
        '50%',
      )
      expect(formatUnit('BY_PERCENTAGE', 5050, usd, 'en-US', 'shares')).toBe(
        '50.50%',
      )
    })

    it('formats amounts via formatCurrency', () => {
      expect(formatUnit('BY_AMOUNT', 1234, usd, 'en-US', 'shares')).toBe(
        '$12.34',
      )
    })

    it('formats shares with the provided label', () => {
      expect(formatUnit('BY_SHARES', 5, usd, 'en-US', 'shares')).toBe(
        '5 shares',
      )
    })
  })
})
