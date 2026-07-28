import { describe, expect, it } from 'vitest'

import type {
  DestinationParticipant,
  NormalizedSource,
} from '@spliit/domain/import'

import {
  importWizardReducer,
  initialWizardState,
  type WizardState,
} from './import-wizard-reducer'
import type { ParticipantMappingState } from './import-wizard-state'

// ── Fixtures ────────────────────────────────────────────────────────────

function makeSource(participantNames: string[]): NormalizedSource {
  return {
    provider: 'SPLIIT',
    sourceGroupId: 'src-1',
    sourceUrl: null,
    name: 'Trip',
    currency: '€',
    currencyCode: 'EUR',
    participants: participantNames.map((sourceName, i) => ({
      sourceId: `s-${i}`,
      sourceName,
    })),
    expenses: [],
  }
}

const GROUP_FORM = {
  name: 'Trip',
  information: '',
  currency: '€',
  currencyCode: 'EUR',
}

const EMPTY_DEST: DestinationParticipant[] = []

// ── Tests ───────────────────────────────────────────────────────────────

describe('initialWizardState', () => {
  it('starts on the "source" step when no prefill', () => {
    const s = initialWizardState(null)
    expect(s.step).toBe('source')
    expect(s.source).toBeNull()
    expect(s.mode).toBeNull()
  })

  it('starts on the "destination" step when arriving with a prefill URL', () => {
    const s = initialWizardState('https://example.com/groups/x')
    expect(s.step).toBe('destination')
  })
})

describe('importWizardReducer', () => {
  it('handles SOURCE_LOADED: stores source, builds participants, advances to destination', () => {
    const start = initialWizardState(null)
    const source = makeSource(['Alice', 'Bob'])
    const next = importWizardReducer(start, {
      type: 'SOURCE_LOADED',
      source,
      accountId: 'user-1',
    })
    expect(next.step).toBe('destination')
    expect(next.source).toBe(source)
    expect(next.participants).toHaveLength(2)
    // First row linked to the importing account, second pending invite.
    expect(next.participants[0].mode).toBe('LINK_ACCOUNT')
    expect(next.participants[0].linkedAccountId).toBe('user-1')
    expect(next.participants[1].mode).toBe('INVITE_BY_EMAIL')
    expect(next.participants[1].inviteEmail).toBe('')
  })

  it('SOURCE_LOADED is idempotent: a second load returns the same state', () => {
    const start = initialWizardState(null)
    const source = makeSource(['Alice'])
    const first = importWizardReducer(start, {
      type: 'SOURCE_LOADED',
      source,
      accountId: 'user-1',
    })
    const second = importWizardReducer(first, {
      type: 'SOURCE_LOADED',
      source,
      accountId: 'user-1',
    })
    expect(second).toBe(first)
  })

  it('handles SOURCE_FAILED: drops the prefill and falls back to "source"', () => {
    const start = initialWizardState('https://example.com/groups/x')
    const next = importWizardReducer(start, { type: 'SOURCE_FAILED' })
    expect(next.step).toBe('source')
    expect(next.prefillSourceUrl).toBeNull()
  })

  it('handles DESTINATION_CHOSEN: sets mode/target/form values and advances to mapping', () => {
    const start = initialWizardState(null)
    const next = importWizardReducer(start, {
      type: 'DESTINATION_CHOSEN',
      mode: 'EXISTING_GROUP',
      targetGroupId: 'g-1',
      groupFormValues: GROUP_FORM,
    })
    expect(next.step).toBe('mapping')
    expect(next.mode).toBe('EXISTING_GROUP')
    expect(next.targetGroupId).toBe('g-1')
    expect(next.groupFormValues).toEqual(GROUP_FORM)
  })

  it('handles MAPPING_CHANGED: replaces participants', () => {
    const start: WizardState = {
      ...initialWizardState(null),
      step: 'mapping',
      participants: [
        {
          key: '0',
          source: { sourceId: 's-0', sourceName: 'Alice' },
          mode: 'LINK_ACCOUNT',
        },
      ],
    }
    const newParticipants: ParticipantMappingState[] = [
      { ...start.participants[0], inviteEmail: 'alice@example.com' },
    ]
    const next = importWizardReducer(start, {
      type: 'MAPPING_CHANGED',
      participants: newParticipants,
    })
    expect(next.participants).toBe(newParticipants)
  })

  it('handles MAPPING_CONFIRMED: stores resolved maps and advances to currencyConversion', () => {
    const start = { ...initialWizardState(null), step: 'mapping' as const }
    const next = importWizardReducer(start, {
      type: 'MAPPING_CONFIRMED',
      sourceIdToDestId: { 's-0': 'd-0' },
      destIds: { 's-0': 'd-0' },
      resolvedExpenses: [],
    })
    expect(next.step).toBe('currencyConversion')
    expect(next.sourceIdToDestId).toEqual({ 's-0': 'd-0' })
    expect(next.destIds).toEqual({ 's-0': 'd-0' })
    expect(next.resolvedExpenses).toEqual([])
    // Rates must reset when entering conversion so the user can pick
    // a fresh rate without being locked to a stale one.
    expect(next.rates).toBeUndefined()
  })

  it('handles CONVERSION_CONFIRMED: stores rates and advances to confirm', () => {
    const start = {
      ...initialWizardState(null),
      step: 'currencyConversion' as const,
    }
    const next = importWizardReducer(start, {
      type: 'CONVERSION_CONFIRMED',
      modes: { 'EUR|USD': 'perDate' },
      fixedRateDates: {},
      fixedRateOverrides: {},
      rates: { '2024-01-01|EUR|USD': 1.1 },
    })
    expect(next.step).toBe('confirm')
    expect(next.conversionModes).toEqual({ 'EUR|USD': 'perDate' })
    expect(next.rates).toEqual({ '2024-01-01|EUR|USD': 1.1 })
  })

  it('handles IMPORT_SUCCEEDED: advances to done', () => {
    const start = { ...initialWizardState(null), step: 'confirm' as const }
    const next = importWizardReducer(start, {
      type: 'IMPORT_SUCCEEDED',
      groupId: 'g-1',
      invites: [],
    })
    expect(next.step).toBe('done')
  })

  it('handles AUTO_MATCH: applies matching against destination participants', () => {
    const start = {
      ...initialWizardState(null),
      step: 'mapping' as const,
      participants: [
        {
          key: '0',
          source: { sourceId: 's-0', sourceName: 'Alice' },
          mode: 'LINK_ACCOUNT' as const,
        },
        {
          key: '1',
          source: { sourceId: 's-1', sourceName: 'Bob' },
          mode: 'INVITE_BY_EMAIL' as const,
          inviteEmail: '',
        },
      ],
    }
    const next = importWizardReducer(start, {
      type: 'AUTO_MATCH',
      destinationParticipants: [
        { id: 'lp-1', name: 'Bob', pending: false, unlinked: false },
      ],
    })
    expect(next.participants[1].mode).toBe('LINK_EXISTING_PARTICIPANT')
    expect(next.participants[1].existingLedgerParticipantId).toBe('lp-1')
  })

  it('AUTO_MATCH is referentially stable when nothing matched', () => {
    const start = {
      ...initialWizardState(null),
      step: 'mapping' as const,
      participants: [
        {
          key: '0',
          source: { sourceId: 's-0', sourceName: 'Alice' },
          mode: 'LINK_ACCOUNT' as const,
        },
      ],
    }
    const next = importWizardReducer(start, {
      type: 'AUTO_MATCH',
      destinationParticipants: EMPTY_DEST,
    })
    expect(next).toBe(start)
  })

  describe('BACK', () => {
    it('source → stays on source', () => {
      const start = initialWizardState(null)
      expect(importWizardReducer(start, { type: 'BACK' })).toBe(start)
    })
    it('destination → source', () => {
      const start = {
        ...initialWizardState(null),
        step: 'destination' as const,
      }
      expect(importWizardReducer(start, { type: 'BACK' }).step).toBe('source')
    })
    it('mapping → destination', () => {
      const start = { ...initialWizardState(null), step: 'mapping' as const }
      expect(importWizardReducer(start, { type: 'BACK' }).step).toBe(
        'destination',
      )
    })
    it('currencyConversion → mapping', () => {
      const start = {
        ...initialWizardState(null),
        step: 'currencyConversion' as const,
      }
      expect(importWizardReducer(start, { type: 'BACK' }).step).toBe('mapping')
    })
    it('confirm → currencyConversion', () => {
      const start = { ...initialWizardState(null), step: 'confirm' as const }
      expect(importWizardReducer(start, { type: 'BACK' }).step).toBe(
        'currencyConversion',
      )
    })
    it('done → stays on done', () => {
      const start = { ...initialWizardState(null), step: 'done' as const }
      expect(importWizardReducer(start, { type: 'BACK' })).toBe(start)
    })
  })
})
