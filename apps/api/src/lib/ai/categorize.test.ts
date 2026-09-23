import { describe, expect, it } from 'vitest'

import { buildCategorizationSystemPrompt, parseCategoryId } from './categorize'

describe('single-expense LLM fallback', () => {
  it('keeps the category allowlist and group context', () => {
    const prompt = buildCategorizationSystemPrompt({
      groupContext: { name: 'Trip', currency: '$', currencyCode: 'EUR' },
      recentExpenses: [{ title: 'Mercadona', categoryId: 'groceries' }],
    })
    expect(prompt).toContain('(ID: groceries)')
    expect(prompt).toContain('Mercadona')
    expect(prompt).toContain('EUR')
  })

  it('rejects unknown category IDs', () => {
    expect(parseCategoryId('groceries')).toBe('groceries')
    expect(parseCategoryId('unknown')).toBe('general')
  })
})
