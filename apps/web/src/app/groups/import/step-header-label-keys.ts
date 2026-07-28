import type { ImportStep } from './import-wizard-state'

/**
 * I18n key for the step's short label shown in the wizard header. Const-typed
 * so `t(STEP_HEADER_LABEL_KEYS[step])` validates each literal against the
 * strict key check without `as any`.
 */
export const STEP_HEADER_LABEL_KEYS = {
  source: 'Groups.Import.StepHeader.source',
  destination: 'Groups.Import.StepHeader.destination',
  mapping: 'Groups.Import.StepHeader.mapping',
  currencyConversion: 'Groups.Import.StepHeader.currencyConversion',
  confirm: 'Groups.Import.StepHeader.confirm',
  done: 'Groups.Import.StepHeader.done',
} as const satisfies Record<ImportStep, string>
