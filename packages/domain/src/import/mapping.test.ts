import { describe, expect, it } from 'vitest'

import { getBalances } from '../balances'
import { expenseApiSchema } from '../schemas'
import {
  applyAutoMatch,
  buildImportBatch,
  computeImportRateKeys,
  findBestNameMatch,
  findImportConflicts,
  makeRateKey,
  substringsOverlap,
  type DestinationParticipant,
  type ImportBatchState,
  type ParticipantMappingState,
} from './mapping'
import type {
  NormalizedSource,
  NormalizedSourceExpense,
  NormalizedSourceParticipant,
} from './types'

const dest = (
  id: string,
  name: string,
  overrides: Partial<DestinationParticipant> = {},
): DestinationParticipant => ({
  id,
  name,
  pending: false,
  unlinked: false,
  ...overrides,
})

const sourcePart = (
  sourceId: string,
  sourceName: string,
): NormalizedSourceParticipant => ({ sourceId, sourceName })

const mappingRow = (
  key: string,
  sourceName: string,
  mode: ParticipantMappingState['mode'],
  overrides: Partial<ParticipantMappingState> = {},
): ParticipantMappingState => ({
  key,
  source: sourcePart(key, sourceName),
  mode,
  ...overrides,
})

const baseSource: NormalizedSource = {
  provider: 'SPLIIT',
  sourceGroupId: 'src-group-1',
  sourceUrl: null,
  name: 'Source group',
  currency: '€',
  currencyCode: 'EUR',
  participants: [],
  expenses: [],
}

const baseExpense = (
  paidBy: string,
  paidFor: Array<{ sourceId: string; shares: number }> = [],
  overrides: Partial<NormalizedSourceExpense> = {},
): NormalizedSourceExpense => ({
  title: 'Dinner',
  expenseDate: '2025-11-15T00:00:00.000Z',
  category: 'food',
  amountCurrency: 'EUR',
  amount: 1000,
  originalAmount: null,
  originalCurrency: null,
  conversionRate: null,
  paidBySourceId: paidBy,
  paidBy: [
    {
      sourceId: paidBy,
      shares: overrides.originalAmount ?? overrides.amount ?? 1000,
    },
  ],
  paidFor,
  splitMode: 'EVENLY',
  recurrenceRule: 'NONE',
  isReimbursement: false,
  notes: null,
  ...overrides,
})

describe('substringsOverlap', () => {
  it('returns false for empty inputs', () => {
    expect(substringsOverlap('', 'John')).toBe(false)
    expect(substringsOverlap('John', '')).toBe(false)
    expect(substringsOverlap('   ', 'John')).toBe(false)
  })

  it('returns true for an exact match', () => {
    expect(substringsOverlap('John', 'John')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(substringsOverlap('ANTONIO', 'antonio')).toBe(true)
    expect(substringsOverlap('John', 'JOH')).toBe(true)
    expect(substringsOverlap('  AnTo  ', 'to')).toBe(true)
  })

  it('returns true when either is a substring of the other', () => {
    expect(substringsOverlap('John', 'Joh')).toBe(true)
    expect(substringsOverlap('Joh', 'John')).toBe(true)
  })

  it('returns false for unrelated strings', () => {
    expect(substringsOverlap('John', 'Jane')).toBe(false)
  })
})

describe('findBestNameMatch', () => {
  const candidates: DestinationParticipant[] = [
    dest('d-1', 'John'),
    dest('d-2', 'Jane'),
    dest('d-3', 'Ant'),
  ]

  it('returns null when there are no candidates', () => {
    expect(findBestNameMatch('John', [])).toBeNull()
  })

  it('prefers an exact match over a substring match', () => {
    expect(findBestNameMatch('John', candidates)).toEqual(candidates[0])
  })

  it('picks the longer substring match when no exact match exists', () => {
    expect(findBestNameMatch('Joh', candidates)).toEqual(candidates[0])
  })

  it('returns null when no candidate overlaps', () => {
    expect(findBestNameMatch('Carla', candidates)).toBeNull()
  })

  it('returns null for an empty source name', () => {
    expect(findBestNameMatch('', candidates)).toBeNull()
  })
})

describe('applyAutoMatch', () => {
  it('returns the same array reference when nothing changes', () => {
    const participants: ParticipantMappingState[] = [
      mappingRow('p-0', 'John', 'LINK_ACCOUNT'),
      mappingRow('p-1', 'Carla', 'INVITE_BY_EMAIL'),
    ]
    const next = applyAutoMatch(participants, [])
    expect(next).toBe(participants)
  })

  it('promotes INVITE_BY_EMAIL rows to LINK_EXISTING_PARTICIPANT on match', () => {
    const participants: ParticipantMappingState[] = [
      mappingRow('p-0', 'John', 'LINK_ACCOUNT'),
      mappingRow('p-1', 'Jane', 'INVITE_BY_EMAIL'),
    ]
    const next = applyAutoMatch(participants, [dest('d-1', 'Jane')])
    expect(next[1].mode).toBe('LINK_EXISTING_PARTICIPANT')
    expect(next[1].existingLedgerParticipantId).toBe('d-1')
    expect(next[1].inviteEmail).toBeUndefined()
    expect(next[1].linkedAccountId).toBeUndefined()
  })

  it('preserves the first row even when its name matches a candidate', () => {
    const participants: ParticipantMappingState[] = [
      mappingRow('p-0', 'John', 'INVITE_BY_EMAIL'),
      mappingRow('p-1', 'Jane', 'INVITE_BY_EMAIL'),
    ]
    const next = applyAutoMatch(participants, [
      dest('d-1', 'John'),
      dest('d-2', 'Jane'),
    ])
    expect(next[0]).toBe(participants[0])
    expect(next[1].mode).toBe('LINK_EXISTING_PARTICIPANT')
  })

  it('only auto-matches rows still in the default INVITE_BY_EMAIL state', () => {
    const participants: ParticipantMappingState[] = [
      mappingRow('p-0', 'John', 'LINK_ACCOUNT'),
      mappingRow('p-1', 'Jane', 'INVITE_BY_LINK', {
        inviteEmail: 'jane@example.com',
      }),
      mappingRow('p-2', 'Carla', 'INVITE_BY_EMAIL'),
    ]
    const next = applyAutoMatch(participants, [dest('d-1', 'Jane')])
    expect(next[1].mode).toBe('INVITE_BY_LINK')
    expect(next[1].inviteEmail).toBe('jane@example.com')
    expect(next[2].mode).toBe('INVITE_BY_EMAIL')
  })

  it('picks the first match when multiple candidates share the same name', () => {
    const participants: ParticipantMappingState[] = [
      mappingRow('p-0', 'John', 'LINK_ACCOUNT'),
      mappingRow('p-1', 'Jane', 'INVITE_BY_EMAIL'),
    ]
    const next = applyAutoMatch(participants, [
      dest('d-1', 'Jane'),
      dest('d-2', 'Jane'),
    ])
    expect(next[1].existingLedgerParticipantId).toBe('d-1')
  })
})

describe('findImportConflicts', () => {
  it('flags two source rows linked to the same existing member (Rule A)', () => {
    const participants: ParticipantMappingState[] = [
      mappingRow('p-0', 'John', 'LINK_EXISTING_PARTICIPANT', {
        existingLedgerParticipantId: 'd-1',
      }),
      mappingRow('p-1', 'Jane', 'LINK_EXISTING_PARTICIPANT', {
        existingLedgerParticipantId: 'd-1',
      }),
    ]
    const conflicts = findImportConflicts(participants, [dest('d-1', 'John')])
    expect(conflicts.get('p-0')).toBe(
      'Two source rows are mapped to the same existing member.',
    )
    expect(conflicts.get('p-1')).toBe(
      'Two source rows are mapped to the same existing member.',
    )
  })

  it('flags an email invite matching a pending destination invite (Rule B)', () => {
    const participants: ParticipantMappingState[] = [
      mappingRow('p-0', 'John', 'LINK_EXISTING_PARTICIPANT', {
        existingLedgerParticipantId: 'd-1',
      }),
      mappingRow('p-1', 'Jane', 'INVITE_BY_EMAIL', {
        inviteEmail: 'jane@example.com',
      }),
    ]
    const conflicts = findImportConflicts(participants, [
      dest('d-1', 'Jane', { pending: true }),
    ])
    expect(conflicts.get('p-1')).toBe(
      `You're inviting jane@example.com but they're already a pending invite; link to them instead.`,
    )
  })

  it('flags an email invite matching an active member (Rule C)', () => {
    const participants: ParticipantMappingState[] = [
      mappingRow('p-0', 'John', 'LINK_EXISTING_PARTICIPANT', {
        existingLedgerParticipantId: 'd-1',
      }),
      mappingRow('p-1', 'Jane', 'INVITE_BY_EMAIL', {
        inviteEmail: 'jane@example.com',
      }),
    ]
    const conflicts = findImportConflicts(participants, [dest('d-1', 'Jane')])
    expect(conflicts.get('p-1')).toBe(
      `You're inviting jane@example.com but they're already a member of this group; link to them instead.`,
    )
  })

  it('flags two LINK_EXISTING rows whose destination names look the same (Rule D)', () => {
    const participants: ParticipantMappingState[] = [
      mappingRow('p-0', 'John', 'LINK_EXISTING_PARTICIPANT', {
        existingLedgerParticipantId: 'd-1',
      }),
      mappingRow('p-1', 'Jane', 'LINK_EXISTING_PARTICIPANT', {
        existingLedgerParticipantId: 'd-2',
      }),
    ]
    const conflicts = findImportConflicts(participants, [
      dest('d-1', 'John Garcia'),
      dest('d-2', 'John'),
    ])
    expect(conflicts.get('p-0')).toBe(
      'Two existing members look like the same person — pick one.',
    )
    expect(conflicts.get('p-1')).toBe(
      'Two existing members look like the same person — pick one.',
    )
  })

  it('does not flag single-letter names on Rule D', () => {
    const participants: ParticipantMappingState[] = [
      mappingRow('p-0', 'John', 'LINK_EXISTING_PARTICIPANT', {
        existingLedgerParticipantId: 'd-1',
      }),
      mappingRow('p-1', 'Jane', 'LINK_EXISTING_PARTICIPANT', {
        existingLedgerParticipantId: 'd-2',
      }),
    ]
    const conflicts = findImportConflicts(participants, [
      dest('d-1', 'A'),
      dest('d-2', 'A'),
    ])
    expect(conflicts.size).toBe(0)
  })

  it('handles undefined destinationParticipants without crashing', () => {
    const participants: ParticipantMappingState[] = [
      mappingRow('p-0', 'John', 'LINK_ACCOUNT'),
    ]
    const conflicts = findImportConflicts(participants)
    expect(conflicts).toBeInstanceOf(Map)
    expect(conflicts.size).toBe(0)
  })

  it('handles undefined destinationParticipants without crashing when called explicitly with undefined', () => {
    const participants: ParticipantMappingState[] = [
      mappingRow('p-0', 'John', 'LINK_ACCOUNT'),
    ]
    const conflicts = findImportConflicts(participants, undefined)
    expect(conflicts).toBeInstanceOf(Map)
    expect(conflicts.size).toBe(0)
  })

  it('handles undefined destinationParticipants with LINK_EXISTING rows without crashing', () => {
    const participants: ParticipantMappingState[] = [
      mappingRow('p-0', 'John', 'LINK_EXISTING_PARTICIPANT', {
        existingLedgerParticipantId: 'd-1',
      }),
    ]
    const conflicts = findImportConflicts(participants)
    expect(conflicts).toBeInstanceOf(Map)
    expect(conflicts.size).toBe(0)
  })

  it('returns no conflicts when mapping is clean', () => {
    const participants: ParticipantMappingState[] = [
      mappingRow('p-0', 'John', 'LINK_ACCOUNT'),
      mappingRow('p-1', 'Jane', 'INVITE_BY_EMAIL', {
        inviteEmail: 'jane@example.com',
      }),
    ]
    const conflicts = findImportConflicts(participants, [dest('d-1', 'Carla')])
    expect(conflicts.size).toBe(0)
  })
})

describe('buildImportBatch', () => {
  const linkedAccountId = 'acc-1'

  it('produces a NEW_GROUP-shaped batch with an Owner placeholder', () => {
    const participants: ParticipantMappingState[] = [
      mappingRow('p-0', 'John', 'LINK_ACCOUNT', { linkedAccountId }),
      mappingRow('p-1', 'Jane', 'INVITE_BY_EMAIL', {
        inviteEmail: 'jane@example.com',
      }),
    ]
    const state: ImportBatchState = {
      source: baseSource,
      mode: 'NEW_GROUP',
      targetGroupId: null,
      groupFormValues: {
        name: 'Trip',
        information: 'info',
        currency: '€',
        currencyCode: 'EUR',
      },
      participants,
      sourceIdToDestId: { 'p-0': 'dest-a', 'p-1': 'dest-b' },
      destIds: { 'p-0': 'dest-a', 'p-1': 'dest-b' },
      resolvedExpenses: [baseExpense('p-0', [{ sourceId: 'p-1', shares: 1 }])],
    }
    const { batch } = buildImportBatch(state, 'EUR')
    if ('targetGroupId' in batch) throw new Error('expected new-group shape')
    expect(batch.groupFormValues).toEqual({
      name: 'Trip',
      information: 'info',
      currency: '€',
      currencyCode: 'EUR',
      participants: [{ name: 'Owner' }],
    })
    expect(batch.participants).toEqual([
      {
        mode: 'LINK_ACCOUNT',
        sourceName: 'John',
        linkedAccountId,
        destLedgerParticipantId: 'dest-a',
      },
      {
        mode: 'INVITE_BY_EMAIL',
        sourceName: 'Jane',
        email: 'jane@example.com',
        destLedgerParticipantId: 'dest-b',
      },
    ])
    expect(batch.expenses).toHaveLength(1)
    expect(batch.expenses[0]).toMatchObject({
      title: 'Dinner',
      paidByList: [{ participant: 'dest-a', shares: 1000 }],
      paidBySplitMode: 'BY_AMOUNT',
      paidFor: [{ participant: 'dest-b', shares: 1 }],
    })
  })

  it('produces an EXISTING_GROUP-shaped batch when targetGroupId is set', () => {
    const participants: ParticipantMappingState[] = [
      mappingRow('p-0', 'John', 'LINK_EXISTING_PARTICIPANT', {
        existingLedgerParticipantId: 'lp-1',
      }),
    ]
    const state: ImportBatchState = {
      source: baseSource,
      mode: 'EXISTING_GROUP',
      targetGroupId: 'grp-9',
      groupFormValues: {
        name: '',
        information: '',
        currency: '€',
        currencyCode: '',
      },
      participants,
      sourceIdToDestId: { 'p-0': 'lp-1' },
      destIds: { 'p-0': 'lp-1' },
      resolvedExpenses: [],
    }
    const { batch } = buildImportBatch(state, '')
    if (!('targetGroupId' in batch))
      throw new Error('expected existing-group shape')
    expect(batch.targetGroupId).toBe('grp-9')
    expect(batch.participants).toEqual([
      {
        mode: 'LINK_EXISTING_PARTICIPANT',
        sourceName: 'John',
        destLedgerParticipantId: 'lp-1',
      },
    ])
  })

  it('produces an INVITE_BY_LINK payload for that mode', () => {
    const participants: ParticipantMappingState[] = [
      mappingRow('p-0', 'John', 'INVITE_BY_LINK'),
    ]
    const state: ImportBatchState = {
      source: baseSource,
      mode: 'NEW_GROUP',
      targetGroupId: null,
      groupFormValues: {
        name: 'Trip',
        information: '',
        currency: '€',
        currencyCode: 'EUR',
      },
      participants,
      sourceIdToDestId: { 'p-0': 'dest-a' },
      destIds: { 'p-0': 'dest-a' },
      resolvedExpenses: [],
    }
    const { batch } = buildImportBatch(state, 'EUR')
    if ('targetGroupId' in batch) throw new Error('expected new-group shape')
    expect(batch.participants).toEqual([
      {
        mode: 'INVITE_BY_LINK',
        sourceName: 'John',
        destLedgerParticipantId: 'dest-a',
      },
    ])
  })

  it('produces an UNLINKED_PARTICIPANT payload without an account id', () => {
    const participants: ParticipantMappingState[] = [
      mappingRow('p-0', 'John', 'UNLINKED_PARTICIPANT'),
    ]
    const state: ImportBatchState = {
      source: baseSource,
      mode: 'NEW_GROUP',
      targetGroupId: null,
      groupFormValues: {
        name: 'Trip',
        information: '',
        currency: '€',
        currencyCode: 'EUR',
      },
      participants,
      sourceIdToDestId: { 'p-0': 'dest-a' },
      destIds: { 'p-0': 'dest-a' },
      resolvedExpenses: [],
    }
    const { batch } = buildImportBatch(state, 'EUR')
    if ('targetGroupId' in batch) throw new Error('expected new-group shape')
    expect(batch.participants).toEqual([
      {
        mode: 'UNLINKED_PARTICIPANT',
        sourceName: 'John',
        destLedgerParticipantId: 'dest-a',
      },
    ])
  })

  it('throws when an expense paidBy is missing from sourceIdToDestId', () => {
    const participants: ParticipantMappingState[] = [
      mappingRow('p-0', 'John', 'LINK_ACCOUNT', {
        linkedAccountId: 'acc-1',
      }),
    ]
    const state: ImportBatchState = {
      source: baseSource,
      mode: 'NEW_GROUP',
      targetGroupId: null,
      groupFormValues: {
        name: 'Trip',
        information: '',
        currency: '€',
        currencyCode: 'EUR',
      },
      participants,
      sourceIdToDestId: {},
      destIds: { 'p-0': 'dest-a' },
      resolvedExpenses: [baseExpense('p-0', [])],
    }
    expect(() => buildImportBatch(state, 'EUR')).toThrow(
      'Missing destination id for paidBy participant p-0',
    )
  })

  it('throws when a non-LINK_EXISTING participant is missing a destination id', () => {
    const participants: ParticipantMappingState[] = [
      mappingRow('p-0', 'John', 'INVITE_BY_LINK'),
    ]
    const state: ImportBatchState = {
      source: baseSource,
      mode: 'NEW_GROUP',
      targetGroupId: null,
      groupFormValues: {
        name: 'Trip',
        information: '',
        currency: '€',
        currencyCode: 'EUR',
      },
      participants,
      sourceIdToDestId: {},
      destIds: {},
      resolvedExpenses: [],
    }
    expect(() => buildImportBatch(state, 'EUR')).toThrow(
      'Missing destination id for source participant "John"',
    )
  })

  describe('cross-currency original fields', () => {
    it('converts from original currency when prior conversion exists even if group currency matches destination', () => {
      // Source group is EUR; expense was entered as 500 JPY then converted to EUR.
      // Import into EUR must re-convert from JPY (original), not treat ledger EUR as expense currency.
      const participants: ParticipantMappingState[] = [
        mappingRow('p-0', 'John', 'LINK_ACCOUNT', {
          linkedAccountId: 'acc-1',
        }),
      ]
      const state: ImportBatchState = {
        source: { ...baseSource, currencyCode: 'EUR' },
        mode: 'EXISTING_GROUP',
        targetGroupId: 'grp-9',
        groupFormValues: {
          name: '',
          information: '',
          currency: '€',
          currencyCode: 'EUR',
        },
        participants,
        sourceIdToDestId: { 'p-0': 'dest-a' },
        destIds: { 'p-0': 'dest-a' },
        resolvedExpenses: [
          baseExpense('p-0', [], {
            amount: 1000,
            amountCurrency: 'EUR',
            originalAmount: 500,
            originalCurrency: 'JPY',
            conversionRate: 0.85,
            paidBy: [{ sourceId: 'p-0', shares: 500 }],
          }),
        ],
      }
      const rates = {
        [makeRateKey('2025-11-15', 'JPY', 'EUR')]: 0.0067,
      }
      const { batch } = buildImportBatch(state, 'EUR', rates)
      if (!('targetGroupId' in batch))
        throw new Error('expected existing-group shape')
      expect(batch.expenses[0].amount).toBe(500)
      expect(batch.expenses[0].conversion).toEqual({
        type: 'exchange',
        currency: 'JPY',
      })
      expect(batch.expenses[0].paidByList[0].shares).toBe(500)
    })

    it('sets conversion when source EUR and destination USD differ', () => {
      const participants: ParticipantMappingState[] = [
        mappingRow('p-0', 'John', 'LINK_ACCOUNT', {
          linkedAccountId: 'acc-1',
        }),
      ]
      const state: ImportBatchState = {
        source: { ...baseSource, currency: '€', currencyCode: 'EUR' },
        mode: 'EXISTING_GROUP',
        targetGroupId: 'grp-9',
        groupFormValues: {
          name: '',
          information: '',
          currency: '€',
          currencyCode: 'EUR',
        },
        participants,
        sourceIdToDestId: { 'p-0': 'dest-a' },
        destIds: { 'p-0': 'dest-a' },
        resolvedExpenses: [baseExpense('p-0', [])],
      }
      const rates = {
        [makeRateKey('2025-11-15', 'EUR', 'USD')]: 1.1,
      }
      const { batch } = buildImportBatch(state, 'USD', rates)
      if (!('targetGroupId' in batch))
        throw new Error('expected existing-group shape')
      // amount stays in expense currency; server converts on import.
      expect(batch.expenses[0].amount).toBe(1000)
      expect(batch.expenses[0].conversion).toEqual({
        type: 'exchange',
        currency: 'EUR',
      })
    })

    it('tags fixed-mode pairs as CUSTOM conversionSource', () => {
      const participants: ParticipantMappingState[] = [
        mappingRow('p-0', 'John', 'LINK_ACCOUNT', {
          linkedAccountId: 'acc-1',
        }),
      ]
      const state: ImportBatchState = {
        source: { ...baseSource, currency: '€', currencyCode: 'EUR' },
        mode: 'EXISTING_GROUP',
        targetGroupId: 'grp-9',
        groupFormValues: {
          name: '',
          information: '',
          currency: '€',
          currencyCode: 'EUR',
        },
        participants,
        sourceIdToDestId: { 'p-0': 'dest-a' },
        destIds: { 'p-0': 'dest-a' },
        resolvedExpenses: [baseExpense('p-0', [])],
        conversionModes: { 'EUR|USD': 'fixed' },
      }
      const rates = {
        [makeRateKey('2025-11-15', 'EUR', 'USD')]: 1.1,
      }
      const { batch } = buildImportBatch(state, 'USD', rates)
      if (!('targetGroupId' in batch))
        throw new Error('expected existing-group shape')
      expect(batch.expenses[0].conversion?.type).toBe('custom')
      expect(batch.expenses[0].amount).toBe(1000)
    })

    it('tags perDate-mode pairs as EXCHANGE conversionSource', () => {
      const participants: ParticipantMappingState[] = [
        mappingRow('p-0', 'John', 'LINK_ACCOUNT', {
          linkedAccountId: 'acc-1',
        }),
      ]
      const state: ImportBatchState = {
        source: { ...baseSource, currency: '€', currencyCode: 'EUR' },
        mode: 'EXISTING_GROUP',
        targetGroupId: 'grp-9',
        groupFormValues: {
          name: '',
          information: '',
          currency: '€',
          currencyCode: 'EUR',
        },
        participants,
        sourceIdToDestId: { 'p-0': 'dest-a' },
        destIds: { 'p-0': 'dest-a' },
        resolvedExpenses: [baseExpense('p-0', [])],
        conversionModes: { 'EUR|USD': 'perDate' },
      }
      const rates = {
        [makeRateKey('2025-11-15', 'EUR', 'USD')]: 1.1,
      }
      const { batch } = buildImportBatch(state, 'USD', rates)
      if (!('targetGroupId' in batch))
        throw new Error('expected existing-group shape')
      expect(batch.expenses[0].conversion?.type).toBe('exchange')
    })

    it('does not convert when both currencies are EUR (same) and no prior conversion', () => {
      const participants: ParticipantMappingState[] = [
        mappingRow('p-0', 'John', 'LINK_ACCOUNT', {
          linkedAccountId: 'acc-1',
        }),
      ]
      const state: ImportBatchState = {
        source: { ...baseSource, currencyCode: 'EUR' },
        mode: 'EXISTING_GROUP',
        targetGroupId: 'grp-9',
        groupFormValues: {
          name: '',
          information: '',
          currency: '€',
          currencyCode: 'EUR',
        },
        participants,
        sourceIdToDestId: { 'p-0': 'dest-a' },
        destIds: { 'p-0': 'dest-a' },
        resolvedExpenses: [
          baseExpense('p-0', [], {
            originalAmount: null,
            originalCurrency: null,
            conversionRate: null,
          }),
        ],
      }
      const { batch } = buildImportBatch(state, 'EUR')
      if (!('targetGroupId' in batch))
        throw new Error('expected existing-group shape')
      expect(batch.expenses[0].conversion).toBeUndefined()
      expect(batch.expenses[0].amount).toBe(1000)
    })

    it('converts from original currency when the source already had a prior conversion and destination differs', () => {
      // Source group EUR; expense originally 1500 JPY converted to 2000 EUR.
      // Import into USD converts from JPY (original), not from ledger EUR.
      const participants: ParticipantMappingState[] = [
        mappingRow('p-0', 'John', 'LINK_ACCOUNT', {
          linkedAccountId: 'acc-1',
        }),
      ]
      const state: ImportBatchState = {
        source: { ...baseSource, currency: '€', currencyCode: 'EUR' },
        mode: 'EXISTING_GROUP',
        targetGroupId: 'grp-9',
        groupFormValues: {
          name: '',
          information: '',
          currency: '€',
          currencyCode: 'EUR',
        },
        participants,
        sourceIdToDestId: { 'p-0': 'dest-a' },
        destIds: { 'p-0': 'dest-a' },
        resolvedExpenses: [
          baseExpense('p-0', [], {
            amount: 2000,
            amountCurrency: 'EUR',
            originalAmount: 1500,
            originalCurrency: 'JPY',
            conversionRate: 0.75,
            paidBy: [{ sourceId: 'p-0', shares: 1500 }],
          }),
        ],
      }
      const rates = {
        [makeRateKey('2025-11-15', 'JPY', 'USD')]: 0.0067,
      }
      const { batch } = buildImportBatch(state, 'USD', rates)
      if (!('targetGroupId' in batch))
        throw new Error('expected existing-group shape')
      expect(batch.expenses[0].amount).toBe(1500)
      expect(batch.expenses[0].conversion).toEqual({
        type: 'exchange',
        currency: 'JPY',
      })
    })

    it('omits conversion when destination matches the original currency', () => {
      // Source expense was USD converted into an EUR group (ledger amount 2000).
      // Import into a USD group uses original USD amount with no further conversion.
      const participants: ParticipantMappingState[] = [
        mappingRow('p-0', 'John', 'LINK_ACCOUNT', {
          linkedAccountId: 'acc-1',
        }),
      ]
      const state: ImportBatchState = {
        source: { ...baseSource, currency: '€', currencyCode: 'EUR' },
        mode: 'EXISTING_GROUP',
        targetGroupId: 'grp-9',
        groupFormValues: {
          name: '',
          information: '',
          currency: '€',
          currencyCode: 'EUR',
        },
        participants,
        sourceIdToDestId: { 'p-0': 'dest-a' },
        destIds: { 'p-0': 'dest-a' },
        resolvedExpenses: [
          baseExpense('p-0', [], {
            amount: 2000,
            amountCurrency: 'EUR',
            originalAmount: 1500,
            originalCurrency: 'USD',
            conversionRate: 0.75,
            paidBy: [{ sourceId: 'p-0', shares: 1500 }],
          }),
        ],
      }
      const { batch } = buildImportBatch(state, 'USD')
      if (!('targetGroupId' in batch))
        throw new Error('expected existing-group shape')
      expect(batch.expenses[0].amount).toBe(1500)
      expect(batch.expenses[0].conversion).toBeUndefined()
      expect(batch.expenses[0].paidByList[0].shares).toBe(1500)
    })

    it('throws when a cross-currency expense is missing the required rate', () => {
      const participants: ParticipantMappingState[] = [
        mappingRow('p-0', 'John', 'LINK_ACCOUNT', {
          linkedAccountId: 'acc-1',
        }),
      ]
      const state: ImportBatchState = {
        source: { ...baseSource, currency: '€', currencyCode: 'EUR' },
        mode: 'EXISTING_GROUP',
        targetGroupId: 'grp-9',
        groupFormValues: {
          name: '',
          information: '',
          currency: '€',
          currencyCode: 'EUR',
        },
        participants,
        sourceIdToDestId: { 'p-0': 'dest-a' },
        destIds: { 'p-0': 'dest-a' },
        resolvedExpenses: [baseExpense('p-0', [])],
      }
      // The wizard passed no `rates` map at all — import must not
      // silently fall back to a placeholder.
      expect(() => buildImportBatch(state, 'USD')).toThrow(
        /cross-currency conversion needs an exchange rate from EUR to USD/,
      )
      // Even with a rates map, a missing key for the specific
      // (date, base, target) tuple is a hard error.
      expect(() => buildImportBatch(state, 'USD', {})).toThrow(
        /missing exchange rate for EUR -> USD on 2025-11-15/,
      )
    })

    it('keeps expense amount in original currency minor units', () => {
      const participants: ParticipantMappingState[] = [
        mappingRow('p-0', 'John', 'LINK_ACCOUNT', {
          linkedAccountId: 'acc-1',
        }),
      ]
      const state: ImportBatchState = {
        source: { ...baseSource, currency: '€', currencyCode: 'EUR' },
        mode: 'EXISTING_GROUP',
        targetGroupId: 'grp-9',
        groupFormValues: {
          name: '',
          information: '',
          currency: '€',
          currencyCode: 'EUR',
        },
        participants,
        sourceIdToDestId: { 'p-0': 'dest-a' },
        destIds: { 'p-0': 'dest-a' },
        resolvedExpenses: [baseExpense('p-0', [], { amount: 333 })],
      }
      const rates = {
        [makeRateKey('2025-11-15', 'EUR', 'USD')]: 1.1234,
      }
      const { batch } = buildImportBatch(state, 'USD', rates)
      if (!('targetGroupId' in batch))
        throw new Error('expected existing-group shape')
      expect(batch.expenses[0].amount).toBe(333)
      expect(batch.expenses[0].paidByList[0].shares).toBe(333)
      expect(batch.expenses[0].conversion?.type).toBe('exchange')
    })

    it('does not convert percentage paidFor shares during currency conversion', () => {
      const participants: ParticipantMappingState[] = [
        mappingRow('p-0', 'John', 'LINK_ACCOUNT', {
          linkedAccountId: 'acc-1',
        }),
        mappingRow('p-1', 'Jane', 'INVITE_BY_LINK'),
      ]
      const state: ImportBatchState = {
        source: { ...baseSource, currency: '€', currencyCode: 'EUR' },
        mode: 'EXISTING_GROUP',
        targetGroupId: 'grp-9',
        groupFormValues: {
          name: '',
          information: '',
          currency: '€',
          currencyCode: 'EUR',
        },
        participants,
        sourceIdToDestId: { 'p-0': 'dest-a', 'p-1': 'dest-b' },
        destIds: { 'p-0': 'dest-a', 'p-1': 'dest-b' },
        resolvedExpenses: [
          baseExpense(
            'p-0',
            [
              { sourceId: 'p-0', shares: 3333 },
              { sourceId: 'p-1', shares: 6667 },
            ],
            { category: 'general', splitMode: 'BY_PERCENTAGE' },
          ),
        ],
      }
      const rates = {
        [makeRateKey('2025-11-15', 'EUR', 'USD')]: 1.1,
      }
      const { batch } = buildImportBatch(state, 'USD', rates)
      if (!('targetGroupId' in batch))
        throw new Error('expected existing-group shape')
      expect(batch.expenses[0]).toMatchObject({
        amount: 1000,
        paidFor: [
          { participant: 'dest-a', shares: 3333 },
          { participant: 'dest-b', shares: 6667 },
        ],
        splitMode: 'BY_PERCENTAGE',
      })
      const parsed = expenseApiSchema.safeParse(batch.expenses[0])
      expect(parsed.error?.issues).toBeUndefined()
    })

    it('keeps BY_AMOUNT paidFor and paidBy in expense currency', () => {
      const participants: ParticipantMappingState[] = [
        mappingRow('p-0', 'John', 'LINK_ACCOUNT', {
          linkedAccountId: 'acc-1',
        }),
        mappingRow('p-1', 'Jane', 'INVITE_BY_LINK'),
      ]
      const state: ImportBatchState = {
        source: { ...baseSource, currency: '€', currencyCode: 'EUR' },
        mode: 'EXISTING_GROUP',
        targetGroupId: 'grp-9',
        groupFormValues: {
          name: '',
          information: '',
          currency: '€',
          currencyCode: 'EUR',
        },
        participants,
        sourceIdToDestId: { 'p-0': 'dest-a', 'p-1': 'dest-b' },
        destIds: { 'p-0': 'dest-a', 'p-1': 'dest-b' },
        resolvedExpenses: [
          baseExpense(
            'p-0',
            [
              { sourceId: 'p-0', shares: 7000 },
              { sourceId: 'p-1', shares: 3000 },
            ],
            {
              amount: 10000,
              splitMode: 'BY_AMOUNT',
              paidBy: [{ sourceId: 'p-0', shares: 10000 }],
            },
          ),
        ],
      }
      const rates = {
        [makeRateKey('2025-11-15', 'EUR', 'USD')]: 0.92,
      }
      const { batch } = buildImportBatch(state, 'USD', rates)
      if (!('targetGroupId' in batch))
        throw new Error('expected existing-group shape')
      const exp = batch.expenses[0]
      expect(exp.amount).toBe(10000)
      expect(exp.conversion?.type).toBe('exchange')
      // paidBy and paidFor stay expense-currency cents
      expect(exp.paidByList).toEqual([{ participant: 'dest-a', shares: 10000 }])
      expect(exp.paidFor).toEqual([
        { participant: 'dest-a', shares: 7000 },
        { participant: 'dest-b', shares: 3000 },
      ])
      expect(exp.paidFor.reduce((s, p) => s + p.shares, 0)).toBe(10000)
    })

    it('cross-currency import produces zero net via getBalances', () => {
      // Imported expense payload keeps expense-currency amounts; balances
      // after server conversion use ledger amounts.
      const participants: ParticipantMappingState[] = [
        mappingRow('p-0', 'John', 'LINK_ACCOUNT', {
          linkedAccountId: 'acc-1',
        }),
        mappingRow('p-1', 'Jane', 'INVITE_BY_LINK'),
      ]
      const state: ImportBatchState = {
        source: { ...baseSource, currency: '€', currencyCode: 'EUR' },
        mode: 'EXISTING_GROUP',
        targetGroupId: 'grp-9',
        groupFormValues: {
          name: '',
          information: '',
          currency: '€',
          currencyCode: 'EUR',
        },
        participants,
        sourceIdToDestId: { 'p-0': 'dest-a', 'p-1': 'dest-b' },
        destIds: { 'p-0': 'dest-a', 'p-1': 'dest-b' },
        resolvedExpenses: [
          baseExpense(
            'p-0',
            [
              { sourceId: 'p-0', shares: 5000 },
              { sourceId: 'p-1', shares: 5000 },
            ],
            {
              amount: 10000,
              splitMode: 'BY_AMOUNT',
              paidBy: [{ sourceId: 'p-0', shares: 10000 }],
            },
          ),
        ],
      }
      const rates = {
        [makeRateKey('2025-11-15', 'EUR', 'USD')]: 0.92,
      }
      const { batch } = buildImportBatch(state, 'USD', rates)
      if (!('targetGroupId' in batch))
        throw new Error('expected existing-group shape')
      const exp = batch.expenses[0]
      expect(exp.amount).toBe(10000)
      expect(exp.paidByList[0].shares).toBe(10000)
      expect(exp.paidFor.map((p) => p.shares)).toEqual([5000, 5000])

      // Batch keeps expense-currency amounts; balances use ledger after server convert.
      // Here we simulate post-resolution ledger amounts for the zero-net check.
      const balances = getBalances([
        {
          amount: 9200,
          splitMode: exp.splitMode,
          paidBySplitMode: exp.paidBySplitMode,
          isReimbursement: exp.isReimbursement,
          originalAmount: 10000,
          originalCurrency: 'EUR',
          conversionRate: 0.92,
          conversionSource: 'EXCHANGE',
          paidByList: exp.paidByList.map((p) => ({
            shares: p.shares,
            participant: { id: p.participant },
          })),
          paidFor: [
            { shares: 4600, participant: { id: exp.paidFor[0].participant } },
            { shares: 4600, participant: { id: exp.paidFor[1].participant } },
          ],
        },
      ])
      const totalPaid = Object.values(balances).reduce((s, b) => s + b.paid, 0)
      const totalPaidFor = Object.values(balances).reduce(
        (s, b) => s + b.paidFor,
        0,
      )
      expect(totalPaid).toBe(9200)
      expect(totalPaidFor).toBe(9200)
      const net = Object.values(balances).reduce((s, b) => s + b.total, 0)
      expect(net).toBe(0)
    })

    it('reconciles BY_AMOUNT paidFor when per-row FX rounding drifts from convertedAmount', () => {
      // €100 @ 0.3333 → 3333¢; 50/50 independent rounds → 1667+1667=3334 without reconcile.
      const participants: ParticipantMappingState[] = [
        mappingRow('p-0', 'John', 'LINK_ACCOUNT', {
          linkedAccountId: 'acc-1',
        }),
        mappingRow('p-1', 'Jane', 'INVITE_BY_LINK'),
      ]
      const state: ImportBatchState = {
        source: { ...baseSource, currency: '€', currencyCode: 'EUR' },
        mode: 'EXISTING_GROUP',
        targetGroupId: 'grp-9',
        groupFormValues: {
          name: '',
          information: '',
          currency: '€',
          currencyCode: 'EUR',
        },
        participants,
        sourceIdToDestId: { 'p-0': 'dest-a', 'p-1': 'dest-b' },
        destIds: { 'p-0': 'dest-a', 'p-1': 'dest-b' },
        resolvedExpenses: [
          baseExpense(
            'p-0',
            [
              { sourceId: 'p-0', shares: 5000 },
              { sourceId: 'p-1', shares: 5000 },
            ],
            {
              amount: 10000,
              category: 'general',
              splitMode: 'BY_AMOUNT',
              paidBy: [{ sourceId: 'p-0', shares: 10000 }],
            },
          ),
        ],
      }
      const rates = {
        [makeRateKey('2025-11-15', 'EUR', 'USD')]: 0.3333,
      }
      const { batch } = buildImportBatch(state, 'USD', rates)
      if (!('targetGroupId' in batch))
        throw new Error('expected existing-group shape')
      const exp = batch.expenses[0]
      expect(exp.amount).toBe(10000)
      expect(exp.paidFor.reduce((s, p) => s + p.shares, 0)).toBe(10000)
      // Shares stay in expense currency (no client-side FX rounding).
      expect(exp.paidFor.map((p) => p.shares).sort((a, b) => a - b)).toEqual([
        5000, 5000,
      ])
      const parsed = expenseApiSchema.safeParse(exp)
      expect(parsed.error?.issues).toBeUndefined()
      expect(parsed.success).toBe(true)
    })

    it('regression: converted Spliit re-import into same currency passes paidByAmountSum', () => {
      // Pre-fix shape: amount/amountCurrency = ledger group; paidBy = original.
      // Import into a group whose currency matches originalCurrency.
      const participants: ParticipantMappingState[] = [
        mappingRow('p-0', 'John', 'LINK_ACCOUNT', {
          linkedAccountId: 'acc-1',
        }),
        mappingRow('p-1', 'Jane', 'INVITE_BY_LINK'),
      ]
      const state: ImportBatchState = {
        source: { ...baseSource, currency: '$', currencyCode: 'USD' },
        mode: 'EXISTING_GROUP',
        targetGroupId: 'grp-9',
        groupFormValues: {
          name: '',
          information: '',
          currency: '€',
          currencyCode: 'EUR',
        },
        participants,
        sourceIdToDestId: { 'p-0': 'dest-a', 'p-1': 'dest-b' },
        destIds: { 'p-0': 'dest-a', 'p-1': 'dest-b' },
        resolvedExpenses: [
          baseExpense(
            'p-0',
            [
              { sourceId: 'p-0', shares: 550 },
              { sourceId: 'p-1', shares: 550 },
            ],
            {
              title: 'Converted dinner',
              amount: 1100,
              amountCurrency: 'USD',
              originalAmount: 1000,
              originalCurrency: 'EUR',
              conversionRate: 1.1,
              splitMode: 'BY_AMOUNT',
              paidBy: [{ sourceId: 'p-0', shares: 1000 }],
              category: 'general',
            },
          ),
        ],
      }
      const { batch } = buildImportBatch(state, 'EUR')
      if (!('targetGroupId' in batch))
        throw new Error('expected existing-group shape')
      const exp = batch.expenses[0]
      expect(exp.amount).toBe(1000)
      expect(exp.conversion).toBeUndefined()
      expect(exp.paidByList.reduce((s, p) => s + p.shares, 0)).toBe(1000)
      expect(exp.paidFor.reduce((s, p) => s + p.shares, 0)).toBe(1000)
      const parsed = expenseApiSchema.safeParse(exp)
      expect(parsed.error?.issues).toBeUndefined()
      expect(parsed.success).toBe(true)
    })

    it('cross-currency from original: rate keys and conversion use original currency', () => {
      const participants: ParticipantMappingState[] = [
        mappingRow('p-0', 'John', 'LINK_ACCOUNT', {
          linkedAccountId: 'acc-1',
        }),
      ]
      const expense = baseExpense('p-0', [], {
        amount: 1100,
        amountCurrency: 'USD',
        originalAmount: 1000,
        originalCurrency: 'EUR',
        conversionRate: 1.1,
        paidBy: [{ sourceId: 'p-0', shares: 1000 }],
      })
      const keys = computeImportRateKeys([expense], 'USD', 'GBP')
      expect(keys).toEqual([{ date: '2025-11-15', base: 'EUR', target: 'GBP' }])

      const rates = {
        [makeRateKey('2025-11-15', 'EUR', 'GBP')]: 0.85,
      }
      const state: ImportBatchState = {
        source: { ...baseSource, currency: '$', currencyCode: 'USD' },
        mode: 'EXISTING_GROUP',
        targetGroupId: 'grp-9',
        groupFormValues: {
          name: '',
          information: '',
          currency: '£',
          currencyCode: 'GBP',
        },
        participants,
        sourceIdToDestId: { 'p-0': 'dest-a' },
        destIds: { 'p-0': 'dest-a' },
        resolvedExpenses: [expense],
      }
      const { batch } = buildImportBatch(state, 'GBP', rates)
      if (!('targetGroupId' in batch))
        throw new Error('expected existing-group shape')
      expect(batch.expenses[0].amount).toBe(1000)
      expect(batch.expenses[0].conversion).toEqual({
        type: 'exchange',
        currency: 'EUR',
      })
    })

    it('splitwise-like rows without original* still use row amount/currency', () => {
      const participants: ParticipantMappingState[] = [
        mappingRow('p-0', 'John', 'LINK_ACCOUNT', {
          linkedAccountId: 'acc-1',
        }),
      ]
      const expense = baseExpense('p-0', [], {
        amount: 2500,
        amountCurrency: 'MKD',
        originalAmount: null,
        originalCurrency: null,
        conversionRate: null,
        paidBy: [{ sourceId: 'p-0', shares: 2500 }],
      })
      const keys = computeImportRateKeys([expense], 'MKD', 'EUR')
      expect(keys).toEqual([{ date: '2025-11-15', base: 'MKD', target: 'EUR' }])

      const rates = {
        [makeRateKey('2025-11-15', 'MKD', 'EUR')]: 0.016,
      }
      const state: ImportBatchState = {
        source: {
          ...baseSource,
          currency: 'ден',
          currencyCode: 'MKD',
          provider: 'SPLITWISE',
        },
        mode: 'EXISTING_GROUP',
        targetGroupId: 'grp-9',
        groupFormValues: {
          name: '',
          information: '',
          currency: '€',
          currencyCode: 'EUR',
        },
        participants,
        sourceIdToDestId: { 'p-0': 'dest-a' },
        destIds: { 'p-0': 'dest-a' },
        resolvedExpenses: [expense],
      }
      const { batch } = buildImportBatch(state, 'EUR', rates)
      if (!('targetGroupId' in batch))
        throw new Error('expected existing-group shape')
      expect(batch.expenses[0].amount).toBe(2500)
      expect(batch.expenses[0].conversion).toEqual({
        type: 'exchange',
        currency: 'MKD',
      })
    })
  })

  describe('computeImportRateKeys', () => {
    it('returns no items when source and destination currencies match', () => {
      expect(computeImportRateKeys([baseExpense('p-0')], 'EUR', 'EUR')).toEqual(
        [],
      )
    })

    it('returns no items when either currency code is missing', () => {
      expect(computeImportRateKeys([], '', 'USD')).toEqual([])
      expect(computeImportRateKeys([], 'EUR', '')).toEqual([])
    })

    it('emits one key per (date, source) pair, deduplicated across expenses', () => {
      const keys = computeImportRateKeys(
        [
          baseExpense('p-0', [], {
            expenseDate: '2025-11-15T00:00:00.000Z',
          }),
          baseExpense('p-1', [], {
            expenseDate: '2025-11-15T00:00:00.000Z',
          }),
          baseExpense('p-2', [], {
            expenseDate: '2025-11-16T00:00:00.000Z',
          }),
        ],
        'EUR',
        'USD',
      )

      expect(keys).toEqual([
        { date: '2025-11-15', base: 'EUR', target: 'USD' },
        { date: '2025-11-16', base: 'EUR', target: 'USD' },
      ])
    })

    it('uses original currency as the base when prior conversion metadata is present', () => {
      const keys = computeImportRateKeys(
        [
          baseExpense('p-0', [], {
            expenseDate: '2025-11-15T00:00:00.000Z',
            amount: 2000,
            amountCurrency: 'EUR',
            originalAmount: 1500,
            originalCurrency: 'JPY',
            conversionRate: 0.75,
          }),
        ],
        'EUR',
        'GBP',
      )

      expect(keys).toEqual([{ date: '2025-11-15', base: 'JPY', target: 'GBP' }])
    })

    it('skips expenses whose original currency already matches the destination', () => {
      const keys = computeImportRateKeys(
        [
          baseExpense('p-0', [], {
            expenseDate: '2025-11-15T00:00:00.000Z',
            amount: 2000,
            amountCurrency: 'EUR',
            originalAmount: 1500,
            originalCurrency: 'USD',
            conversionRate: 0.75,
          }),
          baseExpense('p-1', [], {
            expenseDate: '2025-11-16T00:00:00.000Z',
          }),
        ],
        'EUR',
        'USD',
      )

      // First expense original is USD (matches destination); second has no
      // prior conversion so it uses amountCurrency/source EUR.
      expect(keys).toEqual([{ date: '2025-11-16', base: 'EUR', target: 'USD' }])
    })

    it('normalizes currency codes to upper case', () => {
      const keys = computeImportRateKeys(
        [baseExpense('p-0', [], { expenseDate: '2025-11-15T00:00:00.000Z' })],
        'eur',
        'usd',
      )
      expect(keys).toEqual([{ date: '2025-11-15', base: 'EUR', target: 'USD' }])
    })
  })
})
