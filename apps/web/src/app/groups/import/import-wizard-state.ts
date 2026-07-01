import type {
  NormalizedSource,
  NormalizedSourceExpense,
  NormalizedSourceParticipant,
} from '@spliit/domain/import'

export type ImportStep =
  | 'source'
  | 'destination'
  | 'mapping'
  | 'currencyConversion'
  | 'confirm'
  | 'done'

const STEP_ORDER: ImportStep[] = [
  'source',
  'destination',
  'mapping',
  'currencyConversion',
  'confirm',
  'done',
]

/**
 * i18n keys describing the wizard's nav buttons for a given step.
 *
 * `customBackLabel` / `customContinueLabel` are plain i18n keys (no
 * interpolation). The wizard looks them up directly. The "continue"
 * labels point to the next step in `STEP_ORDER`; the "back" labels
 * point to the previous step. `destination` and `done` have no entry
 * — the wizard renders no Continue or Back button respectively.
 */
export type StepNavigation = {
  previousStepKey?: ImportStep
  nextStepKey?: ImportStep
  /**
   * i18n key for the back-button label. Defaults to
   * `Groups.Import.StepHeader.<previousStep>` ("Back to <prev>" template).
   */
  customBackLabel?: string
  /**
   * i18n key for the continue-button label. Defaults to
   * `Groups.Import.StepHeader.<nextStep>` ("Continue to <next>" template).
   * Steps that want a fixed label (e.g. confirm → "Execute import")
   * set this.
   */
  customContinueLabel?: string
}

export function getStepNavigation(step: ImportStep): StepNavigation {
  const idx = STEP_ORDER.indexOf(step)
  if (idx <= 0) return {}
  const previousStepKey = STEP_ORDER[idx - 1]
  const nextStepKey = STEP_ORDER[idx + 1]
  return {
    previousStepKey,
    nextStepKey,
  }
}

/**
 * i18n keys a wizard step can register as its Continue button label.
 * Narrow union so `t(customContinueLabel)` is strictly typed.
 * Extend here when a new step needs to override the default
 * "Continue to <next>" label.
 */
export type CustomContinueLabelKey =
  | 'Groups.Import.Confirm.importingButton'
  | 'Groups.Import.Confirm.executeImport'

/**
 * Per-step nav metadata the wizard reads to render the bottom
 * Back/Continue buttons. Steps register this from their own state.
 *
 * `onContinue` is the step's ordinary handler. `continueAsFormId`
 * is for steps whose forward action lives in a native `<form>`
 * rendered inside them (e.g. the destination step's group form).
 */
export type StepNavRegistration = {
  onContinue?: () => void
  disabled?: boolean
  customContinueLabel?: CustomContinueLabelKey
  continueAsFormId?: string
}

export type ConversionMode = 'perDate' | 'fixed'

export type ImportMode = 'NEW_GROUP' | 'EXISTING_GROUP'

export type ParticipantMappingMode =
  | 'LINK_ACCOUNT'
  | 'INVITE_BY_EMAIL'
  | 'INVITE_BY_LINK'
  | 'UNLINKED_PARTICIPANT'
  | 'LINK_EXISTING_PARTICIPANT'

export type ParticipantMappingState = {
  key: string
  source: NormalizedSourceParticipant
  mode: ParticipantMappingMode
  linkedAccountId?: string
  inviteEmail?: string
  existingLedgerParticipantId?: string
}

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
  /** Per-pair conversion mode. Key = "BASE|TARGET". */
  conversionModes: Record<string, ConversionMode>
  /** Per-pair fixed-rate date. Key = "BASE|TARGET". */
  fixedRateDates: Record<string, string>
  /** Per-pair custom rate overrides. Key = "BASE|TARGET". */
  fixedRateOverrides: Record<string, number>
}

export const initialGroupFormValues = (source: NormalizedSource | null) => ({
  name: source?.name ?? '',
  information: '',
  currency: source?.currency ?? '€',
  currencyCode: source?.currencyCode ?? '',
})

/**
 * Map the batched expenses into the shape the import mutation expects.
 */
export function buildImportExpenses<
  T extends {
    paidByList: Array<{ participant: string; shares: number }>
    paidBySplitMode: 'BY_AMOUNT'
  },
>(expenses: T[]): T[] {
  return expenses
}
