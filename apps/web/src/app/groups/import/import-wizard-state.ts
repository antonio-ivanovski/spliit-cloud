import { resolveCurrencyCode } from '@spliit/domain/currency'
import type {
  NormalizedSource,
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
 * I18n keys describing the wizard's nav buttons for a given step.
 *
 * `customBackLabel` / `customContinueLabel` are plain i18n keys (no
 * interpolation). The wizard looks them up directly. The "continue" labels
 * point to the next step in `STEP_ORDER`; the "back" labels point to the
 * previous step. `destination` and `done` have no entry — the wizard renders no
 * Continue or Back button respectively.
 */
export type StepNavigation = {
  previousStepKey?: ImportStep
  nextStepKey?: ImportStep
  /**
   * I18n key for the back-button label. Defaults to
   * `Groups.Import.StepHeader.<previousStep>` ("Back to <prev>" template).
   */
  customBackLabel?: string
  /**
   * I18n key for the continue-button label. Defaults to
   * `Groups.Import.StepHeader.<nextStep>` ("Continue to <next>" template).
   * Steps that want a fixed label (e.g. confirm → "Execute import") set this.
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
 * I18n keys a wizard step can register as its Continue button label. Narrow
 * union so `t(customContinueLabel)` is strictly typed. Extend here when a new
 * step needs to override the default "Continue to <next>" label.
 */
export type CustomContinueLabelKey =
  | 'Groups.Import.Confirm.importingButton'
  | 'Groups.Import.Confirm.executeImport'

export type ConversionMode = 'perDate' | 'fixed'

export type ImportMode = 'NEW_GROUP' | 'EXISTING_GROUP'

export type ParticipantMappingMode =
  | 'LINK_ACCOUNT'
  | 'INVITE_BY_EMAIL'
  | 'INVITE_BY_LINK'
  | 'UNLINKED_PARTICIPANT'
  | 'LINK_EXISTING_PARTICIPANT'
  | 'INVITE_CONTACT'

export type ParticipantMappingState = {
  key: string
  source: NormalizedSourceParticipant
  mode: ParticipantMappingMode
  linkedAccountId?: string
  inviteEmail?: string
  existingLedgerParticipantId?: string
  contactAccountId?: string
}

export const initialGroupFormValues = (source: NormalizedSource | null) => {
  const sourceCurrency = source?.currency ?? '€'
  const currencyCode =
    source?.currencyCode || resolveCurrencyCode(sourceCurrency) || ''

  return {
    name: source?.name ?? '',
    information: '',
    currency: sourceCurrency,
    currencyCode,
  }
}

/** Map the batched expenses into the shape the import mutation expects. */
export function buildImportExpenses<
  T extends {
    paidByList: Array<{ participant: string; shares: number }>
    paidBySplitMode: 'BY_AMOUNT'
  },
>(expenses: T[]): T[] {
  return expenses
}
