import { describe, expect, it } from 'vitest'

import {
  generatedSplitPresetName,
  uniqueGeneratedSplitPresetName,
} from '@/app/groups/[groupId]/expenses/expense-form/split-preset-names'

const participants = [
  { id: 'ada', name: 'Ada' },
  { id: 'grace', name: 'Grace' },
  { id: 'katherine', name: 'Katherine' },
  { id: 'mary', name: 'Mary' },
]

const t = (key: string, options?: Record<string, unknown>) => {
  const values = options ?? {}
  switch (key) {
    case 'splitPresets.autoName.paidBySingle':
      return `${String(values.name)} pays`
    case 'splitPresets.autoName.paidByFull':
      return `${String(values.name)} pays the full amount`
    case 'splitPresets.autoName.paidByEveryone':
      return 'Everyone pays equally'
    case 'splitPresets.autoName.paidByEvenly':
      return `${String(values.names)} pay equally`
    case 'splitPresets.autoName.paidForEveryone':
      return 'Everyone splits equally'
    case 'splitPresets.autoName.paidForFull':
      return `${String(values.name)} owes the full amount`
    case 'splitPresets.autoName.paidForEvenly':
      return `${String(values.names)} split equally`
    case 'splitPresets.autoName.paidByItem':
      return `${String(values.name)} pays ${String(values.value)}`
    case 'splitPresets.autoName.paidForItem':
      return `${String(values.name)} owes ${String(values.value)}`
    case 'splitPresets.autoName.paidByGroup':
      return `${String(values.names)} pay ${String(values.value)}`
    case 'splitPresets.autoName.paidForGroup':
      return `${String(values.names)} owe ${String(values.value)}`
    case 'splitPresets.autoName.moreParticipants':
      return `and ${String(values.formattedCount)} others`
    case 'splitPresets.autoName.share':
      return 'shares'
    default:
      return key
  }
}

describe('split preset generated names', () => {
  it('describes a single payer and an all-participant even split', () => {
    expect(
      generatedSplitPresetName({
        target: 'PAID_BY',
        splitMode: 'EVENLY',
        rows: [{ participant: 'ada', shares: 1 }],
        participants,
        locale: 'en-US',
        t,
      }),
    ).toBe('Ada pays')

    expect(
      generatedSplitPresetName({
        target: 'PAID_FOR',
        splitMode: 'EVENLY',
        rows: participants.map(({ id }) => ({ participant: id, shares: 1 })),
        participants,
        locale: 'en-US',
        t,
      }),
    ).toBe('Everyone splits equally')
  })

  it('keeps participant order and truncates long lists', () => {
    expect(
      generatedSplitPresetName({
        target: 'PAID_FOR',
        splitMode: 'EVENLY',
        rows: [
          { participant: 'grace', shares: 1 },
          { participant: 'ada', shares: 1 },
        ],
        participants,
        locale: 'en-US',
        t,
      }),
    ).toBe('Grace and Ada split equally')

    const longParticipants = Array.from({ length: 10 }, (_, index) => ({
      id: `participant-${index}`,
      name: `A very long participant name ${index} that makes the suggestion long`,
    }))
    const suggestion = generatedSplitPresetName({
      target: 'PAID_FOR',
      splitMode: 'BY_PERCENTAGE',
      rows: longParticipants.map(({ id }, index) => ({
        participant: id,
        shares: index === 0 ? 1000 : 100,
      })),
      participants: longParticipants,
      locale: 'en-US',
      t,
    })
    expect(Array.from(suggestion).length).toBeLessThanOrEqual(120)
    expect(suggestion.endsWith('…')).toBe(true)
  })

  it('formats stored percentage units and suffixes generated collisions', () => {
    expect(
      generatedSplitPresetName({
        target: 'PAID_FOR',
        splitMode: 'BY_PERCENTAGE',
        rows: [
          { participant: 'ada', shares: 3000 },
          { participant: 'grace', shares: 7000 },
        ],
        participants,
        locale: 'en-US',
        sharesAreStored: true,
        t,
      }),
    ).toBe('Ada owes 30% · Grace owes 70%')

    expect(
      uniqueGeneratedSplitPresetName('Weekend split', ['weekend split']),
    ).toBe('Weekend split (2)')
    expect(
      uniqueGeneratedSplitPresetName('Weekend split', [
        'Weekend split',
        'Weekend split (2)',
      ]),
    ).toBe('Weekend split (3)')
  })

  it('collapses equal weights and groups repeated non-equal weights', () => {
    expect(
      generatedSplitPresetName({
        target: 'PAID_FOR',
        splitMode: 'BY_SHARES',
        rows: [{ participant: 'ada', shares: 3 }],
        participants,
        locale: 'en-US',
        t,
      }),
    ).toBe('Ada owes the full amount')

    expect(
      generatedSplitPresetName({
        target: 'PAID_FOR',
        splitMode: 'BY_SHARES',
        rows: [
          { participant: 'ada', shares: 2 },
          { participant: 'grace', shares: 2 },
        ],
        participants,
        locale: 'en-US',
        t,
      }),
    ).toBe('Ada and Grace split equally')

    expect(
      generatedSplitPresetName({
        target: 'PAID_FOR',
        splitMode: 'BY_SHARES',
        rows: [
          { participant: 'ada', shares: 2 },
          { participant: 'grace', shares: 2 },
          { participant: 'katherine', shares: 1 },
        ],
        participants,
        locale: 'en-US',
        t,
      }),
    ).toBe('Ada and Grace owe 2 shares · Katherine owes 1 shares')
  })
})
