import { describe, expect, it } from 'vitest'

import { getBalances } from '@spliit/domain'

import { buildScenarios, seedNamespace } from './fixtures'

describe('development fixture accounting', () => {
  it('keeps splits within their ledger and conserves every cent across balances', () => {
    const namespace = seedNamespace('fixture-validation')
    const scenarios = buildScenarios(
      namespace,
      new Date('2026-10-10T12:00:00Z'),
    )
    for (const scenario of scenarios) {
      const validParticipants = new Set(
        Array.from(
          { length: scenario.people },
          (_, index) => `${namespace}-${scenario.key}-p${index}`,
        ),
      )
      const ids = new Set<string>()
      for (const fixture of scenario.expenses) {
        expect(ids.has(fixture.key)).toBe(false)
        ids.add(fixture.key)
        const expense = fixture.input
        for (const row of [
          ...expense.paidByList,
          ...expense.paidFor,
          ...(expense.items ?? []).flatMap((item) => item.paidFor),
          ...(expense.itemizedRemainder?.paidFor ?? []),
        ])
          expect(validParticipants.has(row.participant)).toBe(true)
      }
      const balances = getBalances(
        scenario.expenses.map(({ key, input }) => ({
          ...input,
          id: key,
          paidByList: input.paidByList.map((row) => ({
            shares: row.shares,
            participant: { id: row.participant },
          })),
          paidFor: input.paidFor.map((row) => ({
            shares: row.shares,
            participant: { id: row.participant },
          })),
        })),
      )
      expect(
        Object.values(balances).reduce(
          (sum, balance) => sum + balance.total,
          0,
        ),
      ).toBe(0)
      if (scenario.key === 'settled')
        expect(
          Object.values(balances).every((balance) => balance.total === 0),
        ).toBe(true)
    }
  })
})
