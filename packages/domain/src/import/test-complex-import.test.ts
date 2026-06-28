import { describe, expect, it } from 'vitest'
import { tryParseSpliitExport } from './spliit'
import * as fs from 'fs'
import * as path from 'path'

describe('complex spliit.app export with all features', () => {
  const fixturePath = path.resolve(__dirname, '../fixtures/spliit-export-features.json')
  const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'))

  it('parses successfully', () => {
    const result = tryParseSpliitExport(raw)
    expect(result.ok).toBe(true)
  })

  it('handles all split modes', () => {
    const result = tryParseSpliitExport(raw)
    if (!result.ok) return
    const modes = new Set(result.source.expenses.map((e) => e.splitMode))
    expect(modes.has('EVENLY')).toBe(true)
    expect(modes.has('BY_SHARES')).toBe(true)
    expect(modes.has('BY_PERCENTAGE')).toBe(true)
    expect(modes.has('BY_AMOUNT')).toBe(true)
  })

  it('handles all recurrence rules', () => {
    const result = tryParseSpliitExport(raw)
    if (!result.ok) return
    const rules = new Set(result.source.expenses.map((e) => e.recurrenceRule))
    expect(rules.has('NONE')).toBe(true)
    expect(rules.has('DAILY')).toBe(true)
    expect(rules.has('WEEKLY')).toBe(true)
    expect(rules.has('MONTHLY')).toBe(true)
  })

  it('handles reimbursement flag', () => {
    const result = tryParseSpliitExport(raw)
    if (!result.ok) return
    const reimbursements = result.source.expenses.filter((e) => e.isReimbursement)
    expect(reimbursements.length).toBeGreaterThan(0)
  })

  it('handles multi-currency fields', () => {
    const result = tryParseSpliitExport(raw)
    if (!result.ok) return
    const mc = result.source.expenses.find((e) => e.originalAmount !== null)
    expect(mc).toBeDefined()
    expect(mc!.originalAmount).toBe(50000)
    expect(mc!.originalCurrency).toBe('USD')
    expect(mc!.conversionRate).toBe(0.9)
  })

  it('resolves all numeric category IDs to string IDs', () => {
    const result = tryParseSpliitExport(raw)
    if (!result.ok) return
    const cats = new Set(result.source.expenses.map((e) => e.category))
    // The export has categories like general, dining-out, rent, movies, etc.
    expect(cats.has('dining-out')).toBe(true)
    expect(cats.has('rent')).toBe(true)
    expect(cats.has('groceries')).toBe(true)
    expect(cats.has('gas-fuel')).toBe(true)
    expect(cats.has('payment')).toBe(true)
  })

  it('handles string conversionRate values', () => {
    // The spliit.app export has conversionRate as a string "0.9"
    const modifiedRaw = JSON.parse(JSON.stringify(raw))
    const expenseWithString = modifiedRaw.expenses.find(
      (e: any) => e.originalAmount !== null,
    )
    if (expenseWithString) {
      expenseWithString.conversionRate = '0.9'
    }
    const result = tryParseSpliitExport(modifiedRaw)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const mc = result.source.expenses.find((e) => e.originalAmount !== null)
      expect(mc?.conversionRate).toBe(0.9)
    }
  })
})
