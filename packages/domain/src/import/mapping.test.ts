import { describe, expect, it } from 'vitest'
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
  amount: 1000,
  originalAmount: null,
  originalCurrency: null,
  conversionRate: null,
  paidBySourceId: paidBy,
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
      paidBy: 'dest-a',
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
    it('does not override original fields when source and destination currency codes match', () => {
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
            originalAmount: 500,
            originalCurrency: 'JPY',
            conversionRate: 0.85,
          }),
        ],
      }
      const { batch } = buildImportBatch(state, 'EUR')
      if (!('targetGroupId' in batch))
        throw new Error('expected existing-group shape')
      expect(batch.expenses[0].originalAmount).toBe(500)
      expect(batch.expenses[0].originalCurrency).toBe('JPY')
      expect(batch.expenses[0].conversionRate).toBe(0.85)
    })

    it('sets original fields when source EUR and destination USD differ', () => {
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
      expect(batch.expenses[0].originalAmount).toBe(1000)
      expect(batch.expenses[0].originalCurrency).toBe('EUR')
      expect(batch.expenses[0].conversionRate).toBe(1.1)
      expect(batch.expenses[0].amount).toBe(1100)
    })

    it('does not override when both currencies are EUR (same)', () => {
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
      expect(batch.expenses[0].originalAmount).toBeUndefined()
      expect(batch.expenses[0].originalCurrency).toBeUndefined()
      expect(batch.expenses[0].conversionRate).toBeUndefined()
    })

    it('uses source expense originalCurrency (not source group currency) when the source already had a prior conversion and destination differs', () => {
      // The source group is in EUR, but the source expense was originally
      // entered as 1500 JPY and converted to 2000 EUR at a rate of 0.75.
      // Importing into a USD group should convert the *original* JPY
      // amount to USD, not redo the JPY->EUR conversion.
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
            originalAmount: 1500,
            originalCurrency: 'JPY',
            conversionRate: 0.75,
          }),
        ],
      }
      const rates = {
        [makeRateKey('2025-11-15', 'JPY', 'USD')]: 0.0067,
      }
      const { batch } = buildImportBatch(state, 'USD', rates)
      if (!('targetGroupId' in batch))
        throw new Error('expected existing-group shape')
      expect(batch.expenses[0].originalAmount).toBe(1500)
      expect(batch.expenses[0].originalCurrency).toBe('JPY')
      expect(batch.expenses[0].conversionRate).toBe(0.0067)
      expect(batch.expenses[0].amount).toBe(Math.round(1500 * 0.0067))
    })

    it('preserves the source expense originalAmount when destination matches the source group currency', () => {
      // The source expense already has a USD->EUR prior conversion. The
      // destination is also EUR, so the wizard should NOT redo the
      // conversion; the source expense's audit fields pass through and
      // the converted `amount` is left alone.
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
            originalAmount: 1500,
            originalCurrency: 'USD',
            conversionRate: 0.75,
          }),
        ],
      }
      const { batch } = buildImportBatch(state, 'EUR')
      if (!('targetGroupId' in batch))
        throw new Error('expected existing-group shape')
      expect(batch.expenses[0].amount).toBe(2000)
      expect(batch.expenses[0].originalAmount).toBe(1500)
      expect(batch.expenses[0].originalCurrency).toBe('USD')
      expect(batch.expenses[0].conversionRate).toBe(0.75)
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

    it('rounds the converted amount to the nearest minor unit', () => {
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
      expect(batch.expenses[0].amount).toBe(Math.round(333 * 1.1234))
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

    it('uses the expense originalCurrency as the base when it differs from the source group currency', () => {
      const keys = computeImportRateKeys(
        [
          baseExpense('p-0', [], {
            expenseDate: '2025-11-15T00:00:00.000Z',
            amount: 2000,
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

    it('skips expenses whose effective original currency already matches the destination', () => {
      const keys = computeImportRateKeys(
        [
          baseExpense('p-0', [], {
            expenseDate: '2025-11-15T00:00:00.000Z',
            amount: 2000,
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

      // The first expense was already in USD (matches destination), the
      // second has no prior conversion so it falls back to the source
      // group's EUR. Only the second needs a rate.
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
