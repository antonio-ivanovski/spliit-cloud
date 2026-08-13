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
import {
  initialGroupFormValues,
  getStepNavigation,
  isDocumentImportFailure,
  shouldDiscardStagedDocumentTokens,
  type ParticipantMappingState,
} from './import-wizard-state'

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

describe('initialGroupFormValues', () => {
  it('preserves exported group information', () => {
    expect(
      initialGroupFormValues({
        ...makeSource([]),
        information: 'Bring receipts',
      }).information,
    ).toBe('Bring receipts')
  })

  it('maps a custom exported ruble symbol to RUB', () => {
    const values = initialGroupFormValues({
      provider: 'SPLIIT',
      sourceGroupId: 'src-1',
      sourceUrl: null,
      name: 'Trip',
      currency: '₽',
      currencyCode: null,
      participants: [],
      expenses: [],
    })

    expect(values.currency).toBe('₽')
    expect(values.currencyCode).toBe('RUB')
  })

  it('keeps an unrecognized custom currency and explicit empty code', () => {
    const values = initialGroupFormValues({
      provider: 'SPLIIT',
      sourceGroupId: 'src-1',
      sourceUrl: null,
      name: 'Trip',
      currency: 'gold coins',
      currencyCode: null,
      participants: [],
      expenses: [],
    })

    expect(values.currency).toBe('gold coins')
    expect(values.currencyCode).toBe('')
  })
})

describe('isDocumentImportFailure', () => {
  it('recognizes server staging errors without catching unrelated imports', () => {
    expect(
      isDocumentImportFailure('Staged import document token is invalid'),
    ).toBe(true)
    expect(
      isDocumentImportFailure('Staged Cloud import document is unavailable'),
    ).toBe(true)
    expect(
      isDocumentImportFailure(
        'Every included document must be staged or explicitly skipped',
      ),
    ).toBe(true)
    expect(isDocumentImportFailure('Target group not found')).toBe(false)
  })
})

describe('document-aware wizard navigation', () => {
  it('links currency conversion directly to confirm when Documents is skipped', () => {
    expect(
      getStepNavigation('currencyConversion', { includeDocuments: false }),
    ).toMatchObject({ nextStepKey: 'confirm' })
    expect(
      getStepNavigation('confirm', { includeDocuments: false }),
    ).toMatchObject({ previousStepKey: 'currencyConversion' })
  })

  it('keeps Documents in navigation for supported imports', () => {
    expect(getStepNavigation('currencyConversion')).toMatchObject({
      nextStepKey: 'documents',
    })
    expect(getStepNavigation('confirm')).toMatchObject({
      previousStepKey: 'documents',
    })
  })

  it('keeps Cloud mapping and Documents connected through currency conversion', () => {
    expect(getStepNavigation('mapping')).toMatchObject({
      nextStepKey: 'currencyConversion',
    })
    expect(getStepNavigation('documents')).toMatchObject({
      previousStepKey: 'currencyConversion',
    })
  })
})

describe('shouldDiscardStagedDocumentTokens', () => {
  it('only discards tokens the server reports as expired or unavailable', () => {
    expect(
      shouldDiscardStagedDocumentTokens(
        'Staged import document token is invalid or expired',
      ),
    ).toBe(true)
    expect(
      shouldDiscardStagedDocumentTokens(
        'Staged import document is unavailable',
      ),
    ).toBe(true)
    expect(
      shouldDiscardStagedDocumentTokens(
        'Staged Cloud import document failed validation',
      ),
    ).toBe(true)
    expect(
      shouldDiscardStagedDocumentTokens('Duplicate staged import document'),
    ).toBe(false)
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

  it('uses the shared wizard with currency conversion for Cloud sources', () => {
    const source = makeSource(['Alice'])
    const start = initialWizardState(null)
    const loaded = importWizardReducer(start, {
      type: 'SOURCE_LOADED',
      source,
      accountId: 'user-1',
      sourceKind: 'CLOUD',
      cloudInspection: null,
    })
    const mapped = importWizardReducer(loaded, {
      type: 'MAPPING_CONFIRMED',
      sourceIdToDestId: { 's-0': 'd-0' },
      destIds: { 's-0': 'd-0' },
      resolvedExpenses: [],
    })

    expect(mapped.step).toBe('currencyConversion')
    const converted = importWizardReducer(mapped, {
      type: 'CONVERSION_CONFIRMED',
      modes: {},
      fixedRateDates: {},
      fixedRateOverrides: {},
      rates: {},
    })
    expect(converted.step).toBe('documents')
    expect(importWizardReducer(converted, { type: 'BACK' }).step).toBe(
      'currencyConversion',
    )
  })

  it('stores Cloud archive and document claims in the shared state', () => {
    const start = {
      ...initialWizardState(null),
      sourceKind: 'CLOUD' as const,
      step: 'documents' as const,
    }
    const archived = importWizardReducer(start, {
      type: 'ARCHIVE_CHANGED',
      archived: true,
    })
    const next = importWizardReducer(archived, {
      type: 'DOCUMENTS_CONFIRMED',
      stagedTokens: ['token-1'],
      recoveredCount: 1,
      skippedCount: 1,
      skippedEntirely: false,
      cloudDocuments: [{ sourceDocumentId: 'doc-1', stagedToken: 'token-1' }],
      cloudSkippedDocumentIds: ['doc-2'],
      cloudIssuesAcknowledged: true,
    })

    expect(next.archived).toBe(true)
    expect(next.cloudStagedDocuments).toEqual([
      { sourceDocumentId: 'doc-1', stagedToken: 'token-1' },
    ])
    expect(next.cloudSkippedDocumentIds).toEqual(['doc-2'])
    expect(next.cloudDocumentIssuesAcknowledged).toBe(true)
  })

  it('returns to source while retaining the inspected Cloud bundle', () => {
    const inspection = { kind: 'GROUP' as const } as NonNullable<
      WizardState['cloudInspection']
    >
    const start = {
      ...initialWizardState(null),
      sourceKind: 'CLOUD' as const,
      source: makeSource(['Alice']),
      cloudInspection: inspection,
      step: 'destination' as const,
    }
    const next = importWizardReducer(start, { type: 'RETURN_TO_SOURCE' })
    expect(next.step).toBe('source')
    expect(next.source).toBeNull()
    expect(next.sourceKind).toBe('CLOUD')
    expect(next.cloudInspection).toBe(inspection)
  })

  it('handles CONVERSION_CONFIRMED: stores rates and advances Spliit imports to documents', () => {
    const start = {
      ...initialWizardState(null),
      step: 'currencyConversion' as const,
      source: makeSource(['Alice']),
    }
    const next = importWizardReducer(start, {
      type: 'CONVERSION_CONFIRMED',
      modes: { 'EUR|USD': 'perDate' },
      fixedRateDates: {},
      fixedRateOverrides: {},
      rates: { '2024-01-01|EUR|USD': 1.1 },
    })
    expect(next.step).toBe('documents')
    expect(next.conversionModes).toEqual({ 'EUR|USD': 'perDate' })
    expect(next.rates).toEqual({ '2024-01-01|EUR|USD': 1.1 })
  })

  it('handles DOCUMENTS_CONFIRMED: stores staged results and advances to confirm', () => {
    const start = {
      ...initialWizardState(null),
      step: 'documents' as const,
    }
    const next = importWizardReducer(start, {
      type: 'DOCUMENTS_CONFIRMED',
      stagedTokens: ['token-1'],
      recoveredCount: 1,
      skippedCount: 2,
      skippedEntirely: false,
    })
    expect(next.step).toBe('confirm')
    expect(next.stagedDocumentTokens).toEqual(['token-1'])
    expect(next.recoveredDocumentCount).toBe(1)
    expect(next.skippedDocumentCount).toBe(2)
    expect(next.documentRecoverySkipped).toBe(false)
    expect(next.documentFlowVisited).toBe(true)
  })

  it('skips the documents step for a Spliit CSV source', () => {
    const start = {
      ...initialWizardState(null),
      step: 'currencyConversion' as const,
      source: {
        ...makeSource(['Alice']),
        sourceGroupId: 'csv-import',
      },
    }
    const next = importWizardReducer(start, {
      type: 'CONVERSION_CONFIRMED',
      modes: {},
      fixedRateDates: {},
      fixedRateOverrides: {},
      rates: {},
    })

    expect(next.step).toBe('confirm')
    expect(next.documentFlowVisited).toBe(false)
  })

  it('returns reusable document failures to Documents with staging retained', () => {
    const start = {
      ...initialWizardState(null),
      step: 'confirm' as const,
      stagedDocumentTokens: ['dead-token'],
      recoveredDocumentCount: 1,
      documentFlowVisited: true,
    }
    const next = importWizardReducer(start, {
      type: 'DOCUMENTS_FAILED',
      discardTokens: false,
    })

    expect(next.step).toBe('documents')
    expect(next.stagedDocumentTokens).toEqual(['dead-token'])
    expect(next.recoveredDocumentCount).toBe(1)
    expect(next.documentFlowVisited).toBe(true)
  })

  it('clears expired or unavailable document staging before retry', () => {
    const start = {
      ...initialWizardState(null),
      step: 'confirm' as const,
      stagedDocumentTokens: ['expired-token'],
      recoveredDocumentCount: 1,
      documentFlowVisited: true,
    }
    const next = importWizardReducer(start, {
      type: 'DOCUMENTS_FAILED',
      discardTokens: true,
    })

    expect(next.step).toBe('documents')
    expect(next.stagedDocumentTokens).toEqual([])
    expect(next.recoveredDocumentCount).toBe(0)
    expect(next.documentFlowVisited).toBe(false)
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
    it('documents → currencyConversion', () => {
      const start = { ...initialWizardState(null), step: 'documents' as const }
      expect(importWizardReducer(start, { type: 'BACK' }).step).toBe(
        'currencyConversion',
      )
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
