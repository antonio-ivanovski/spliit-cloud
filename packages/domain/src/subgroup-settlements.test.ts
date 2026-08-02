import { describe, expect, it } from 'vitest'

import type { Balances } from './balances'
import {
  getIndividualSettlementPlan,
  getSubgroupSettlementPlan,
  type SubgroupDefinition,
} from './subgroup-settlements'

function balancesFromTotals(totals: Record<string, number>): Balances {
  return Object.fromEntries(
    Object.entries(totals).map(([participantId, total]) => [
      participantId,
      { paid: 0, paidFor: 0, total },
    ]),
  )
}

const coupleA: SubgroupDefinition = {
  id: 'couple-a',
  name: 'Couple A',
  memberIds: ['alice', 'bob'],
}
const coupleB: SubgroupDefinition = {
  id: 'couple-b',
  name: 'Couple B',
  memberIds: ['carol', 'dave'],
}

describe('subgroup settlement projections', () => {
  it('clears virtual subgroup totals with unit-to-unit legs', () => {
    const balances = balancesFromTotals({
      alice: 120,
      bob: -20,
      carol: 30,
      dave: -80,
      erin: -50,
    })
    const plan = getSubgroupSettlementPlan(balances, Object.keys(balances), [
      { id: 'couple', name: 'Couple', memberIds: ['alice', 'bob'] },
      { id: 'family', name: 'Family', memberIds: ['carol', 'dave'] },
    ])
    const totals = new Map(
      plan.units.map((unit) => [unit.kind + ':' + unit.id, unit.total]),
    )

    for (const leg of plan.legs) {
      totals.set(
        `${leg.from.kind}:${leg.from.id}`,
        (totals.get(`${leg.from.kind}:${leg.from.id}`) ?? 0) + leg.amount,
      )
      totals.set(
        `${leg.to.kind}:${leg.to.id}`,
        (totals.get(`${leg.to.kind}:${leg.to.id}`) ?? 0) - leg.amount,
      )
    }

    expect(plan.legs).toHaveLength(2)
    expect([...totals.values()]).toEqual([0, 0, 0])
    expect(plan.legs.every((leg) => leg.from.id !== leg.to.id)).toBe(true)
    expect(plan.legs.every((leg) => leg.payerId && leg.receiverId)).toBe(true)
  })

  it('keeps individual suggestions inside settled subgroups when possible', () => {
    const plan = getIndividualSettlementPlan(
      balancesFromTotals({
        alice: 100,
        bob: -100,
        carol: 100,
        dave: -100,
      }),
      [coupleA, coupleB],
    )

    expect(plan.policy).toBe('within-subgroups')
    expect(plan.reimbursements).toEqual([
      { from: 'bob', to: 'alice', amount: 100 },
      { from: 'dave', to: 'carol', amount: 100 },
    ])
  })

  it('uses the group-wide projection when a cross-subgroup transfer is required', () => {
    const plan = getIndividualSettlementPlan(
      balancesFromTotals({
        alice: 100,
        bob: 0,
        carol: -100,
        dave: 0,
      }),
      [coupleA, coupleB],
    )

    expect(plan.policy).toBe('all-individual')
    expect(plan.reimbursements).toEqual([
      { from: 'carol', to: 'alice', amount: 100 },
    ])
  })

  it('keeps the standard policy when no subgroups are configured', () => {
    const plan = getIndividualSettlementPlan(
      balancesFromTotals({ alice: 0, bob: 0 }),
      [],
    )

    expect(plan).toEqual({ reimbursements: [], policy: 'standard' })
  })

  it('reports internal balances after subgroup totals are settled', () => {
    const plan = getSubgroupSettlementPlan(
      balancesFromTotals({ alice: 100, bob: -100 }),
      ['alice', 'bob'],
      [coupleA],
    )

    expect(plan.legs).toEqual([])
    expect(plan.hasInternalBalances).toBe(true)
  })

  it('reports internal balances that remain after a cross-subgroup leg', () => {
    const plan = getSubgroupSettlementPlan(
      balancesFromTotals({ alice: 50, bob: -150, carol: 100 }),
      ['alice', 'bob', 'carol'],
      [coupleA],
    )

    expect(plan.legs).toEqual([
      expect.objectContaining({
        amount: 100,
        payerId: 'bob',
        receiverId: 'carol',
      }),
    ])
    expect(plan.hasInternalBalances).toBe(true)
  })

  it('uses discriminated virtual keys when subgroup and participant ids match', () => {
    const plan = getSubgroupSettlementPlan(
      balancesFromTotals({
        shared: 100,
        debtor: -100,
        receiver: 50,
        external: -50,
      }),
      ['shared', 'debtor', 'receiver', 'external'],
      [
        {
          id: 'external',
          name: 'External subgroup',
          memberIds: ['shared', 'debtor'],
        },
      ],
    )

    expect(plan.units).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'subgroup', id: 'external' }),
        expect.objectContaining({ kind: 'participant', id: 'external' }),
      ]),
    )
    expect(plan.legs).toEqual([
      expect.objectContaining({
        from: { kind: 'participant', id: 'external' },
        to: { kind: 'participant', id: 'receiver' },
      }),
    ])
  })
})
