import type { AppRouterOutput } from '@spliit/api/router'
import {
  applyAutoMatch,
  type DestinationParticipant,
  type NormalizedSource,
  type NormalizedSourceExpense,
  type NormalizedSourceParticipant,
} from '@spliit/domain/import'

import {
  initialGroupFormValues,
  supportsDocumentRecovery,
  type ConversionMode,
  type ImportMode,
  type ImportStep,
  type ParticipantMappingState,
} from './import-wizard-state'

type ImportInvite = NonNullable<
  AppRouterOutput['groups']['import']
>['invites'][number]

export type WizardState = {
  step: ImportStep
  source: NormalizedSource | null
  prefillSourceUrl: string | null
  mode: ImportMode | null
  targetGroupId: string | null
  groupFormValues: {
    name: string
    information: string
    currency: string
    currencyCode: string
  }
  participants: ParticipantMappingState[]
  sourceIdToDestId: Record<string, string>
  destIds: Record<string, string>
  resolvedExpenses: NormalizedSourceExpense[]
  rates: Record<string, number> | null | undefined
  conversionModes: Record<string, ConversionMode>
  fixedRateDates: Record<string, string>
  fixedRateOverrides: Record<string, number>
  documentSessionId: string
  stagedDocumentTokens: string[]
  recoveredDocumentCount: number
  skippedDocumentCount: number
  documentRecoverySkipped: boolean
  documentFlowVisited: boolean
}

export type WizardAction =
  | {
      type: 'SOURCE_LOADED'
      source: NormalizedSource
      accountId: string | undefined
    }
  | { type: 'SOURCE_FAILED' }
  | {
      type: 'DESTINATION_CHOSEN'
      mode: ImportMode
      targetGroupId: string | null
      groupFormValues: WizardState['groupFormValues']
    }
  | { type: 'MAPPING_CHANGED'; participants: ParticipantMappingState[] }
  | {
      type: 'MAPPING_CONFIRMED'
      sourceIdToDestId: Record<string, string>
      destIds: Record<string, string>
      resolvedExpenses: NormalizedSourceExpense[]
    }
  | {
      type: 'CONVERSION_CONFIRMED'
      modes: Record<string, ConversionMode>
      fixedRateDates: Record<string, string>
      fixedRateOverrides: Record<string, number>
      rates: Record<string, number>
    }
  | {
      type: 'DOCUMENTS_CONFIRMED'
      stagedTokens: string[]
      recoveredCount: number
      skippedCount: number
      skippedEntirely: boolean
    }
  | { type: 'DOCUMENTS_FAILED'; discardTokens: boolean }
  | {
      type: 'IMPORT_SUCCEEDED'
      groupId: string
      invites: ImportInvite[]
    }
  | { type: 'AUTO_MATCH'; destinationParticipants: DestinationParticipant[] }
  | { type: 'BACK' }

export function initialWizardState(
  prefillSourceUrl: string | null,
): WizardState {
  return {
    step: prefillSourceUrl ? 'destination' : 'source',
    source: null,
    prefillSourceUrl,
    mode: null,
    targetGroupId: null,
    groupFormValues: initialGroupFormValues(null),
    participants: [],
    sourceIdToDestId: {},
    destIds: {},
    resolvedExpenses: [],
    rates: undefined,
    conversionModes: {},
    fixedRateDates: {},
    fixedRateOverrides: {},
    documentSessionId: crypto.randomUUID(),
    stagedDocumentTokens: [],
    recoveredDocumentCount: 0,
    skippedDocumentCount: 0,
    documentRecoverySkipped: false,
    documentFlowVisited: false,
  }
}

function buildInitialParticipants(
  source: NormalizedSource,
  accountId: string | undefined,
): ParticipantMappingState[] {
  return source.participants.map(
    (p: NormalizedSourceParticipant, i: number) => ({
      key: `${p.sourceId}-${i}`,
      source: p,
      mode: i === 0 ? 'LINK_ACCOUNT' : 'INVITE_BY_EMAIL',
      linkedAccountId: i === 0 ? accountId : undefined,
      inviteEmail: i === 0 ? undefined : '',
    }),
  )
}

export function importWizardReducer(
  state: WizardState,
  action: WizardAction,
): WizardState {
  switch (action.type) {
    case 'SOURCE_LOADED':
      // Idempotent: ignore subsequent loads once we already have a source.
      if (state.source) return state
      return {
        ...state,
        source: action.source,
        participants: buildInitialParticipants(action.source, action.accountId),
        groupFormValues: initialGroupFormValues(action.source),
        step: 'destination',
      }

    case 'SOURCE_FAILED':
      // Already on the source step if no source was loaded; otherwise
      // keep the loaded data and surface the error via prefill.
      if (state.source) return state
      return { ...state, step: 'source', prefillSourceUrl: null }

    case 'DESTINATION_CHOSEN':
      return {
        ...state,
        mode: action.mode,
        targetGroupId: action.targetGroupId,
        groupFormValues: action.groupFormValues,
        step: 'mapping',
      }

    case 'MAPPING_CHANGED':
      return { ...state, participants: action.participants }

    case 'MAPPING_CONFIRMED':
      return {
        ...state,
        sourceIdToDestId: action.sourceIdToDestId,
        destIds: action.destIds,
        resolvedExpenses: action.resolvedExpenses,
        rates: undefined,
        step: 'currencyConversion',
      }

    case 'CONVERSION_CONFIRMED':
      return {
        ...state,
        conversionModes: action.modes,
        fixedRateDates: action.fixedRateDates,
        fixedRateOverrides: action.fixedRateOverrides,
        rates: action.rates,
        step: supportsDocumentRecovery(state.source) ? 'documents' : 'confirm',
      }

    case 'DOCUMENTS_CONFIRMED':
      return {
        ...state,
        stagedDocumentTokens: action.stagedTokens,
        recoveredDocumentCount: action.recoveredCount,
        skippedDocumentCount: action.skippedCount,
        documentRecoverySkipped: action.skippedEntirely,
        documentFlowVisited: true,
        step: 'confirm',
      }

    case 'DOCUMENTS_FAILED':
      if (!action.discardTokens) {
        return { ...state, step: 'documents' }
      }
      return {
        ...state,
        step: 'documents',
        stagedDocumentTokens: [],
        recoveredDocumentCount: 0,
        skippedDocumentCount: 0,
        documentRecoverySkipped: false,
        documentFlowVisited: false,
      }

    case 'IMPORT_SUCCEEDED':
      // The mutation result is the source of truth for the done step;
      // no in-memory state to update beyond advancing the step.
      return { ...state, step: 'done' }

    case 'AUTO_MATCH': {
      const next = applyAutoMatch(
        state.participants,
        action.destinationParticipants,
      )
      // Skip the state copy when no auto-match happened — keeps the
      // reference stable for downstream memoization.
      if (next === state.participants) return state
      return { ...state, participants: next }
    }

    case 'BACK': {
      switch (state.step) {
        case 'source':
          return state
        case 'destination':
          return { ...state, step: 'source' }
        case 'mapping':
          return { ...state, step: 'destination' }
        case 'currencyConversion':
          return { ...state, step: 'mapping' }
        case 'documents':
          return { ...state, step: 'currencyConversion' }
        case 'confirm':
          return {
            ...state,
            step: state.documentFlowVisited
              ? 'documents'
              : 'currencyConversion',
          }
        case 'done':
          return state
      }
    }
  }
}
