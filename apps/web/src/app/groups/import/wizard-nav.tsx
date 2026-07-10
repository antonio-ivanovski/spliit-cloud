import {
  WizardNav as SharedWizardNav,
  WizardStepHeader,
} from '@/components/wizard'
import { useTranslation } from 'react-i18next'
import {
  type CustomContinueLabelKey,
  type ImportStep,
  getStepNavigation,
} from './import-wizard-state'

/**
 * i18n key for the step's short label shown in the wizard header.
 * Const-typed so `t(STEP_HEADER_LABEL_KEYS[step])` validates each
 * literal against the strict key check without `as any`.
 */
export const STEP_HEADER_LABEL_KEYS = {
  source: 'Groups.Import.StepHeader.source',
  destination: 'Groups.Import.StepHeader.destination',
  mapping: 'Groups.Import.StepHeader.mapping',
  currencyConversion: 'Groups.Import.StepHeader.currencyConversion',
  confirm: 'Groups.Import.StepHeader.confirm',
  done: 'Groups.Import.StepHeader.done',
} as const satisfies Record<ImportStep, string>

export function StepHeader({ step }: { step: ImportStep }) {
  const { t } = useTranslation()
  const stepLabel = t(STEP_HEADER_LABEL_KEYS[step])
  return (
    <WizardStepHeader
      eyebrow={t('Groups.Import.StepHeader.title')}
      title={stepLabel}
    />
  )
}

export type WizardNavProps = {
  step: ImportStep
  /**
   * Back-button handler. Steps whose position has no previous step
   * simply omit this prop and the Back button is hidden.
   */
  onBack?: () => void
  /**
   * Continue-button handler. If both `onContinue` and
   * `continueAsFormId` are absent, the Continue button is hidden
   * (used by the source step, which transitions via its own
   * inputs, and the done step, which renders its own CTA).
   */
  onContinue?: () => void
  /**
   * When set, the Continue button submits the given `<form>` via
   * `form={continueAsFormId}` instead of firing `onContinue`. Used
   * by the destination step whose forward action lives in the
   * group-creation `<form>` it renders.
   */
  continueAsFormId?: string
  continueDisabled?: boolean
  customContinueLabel?: CustomContinueLabelKey
}

/**
 * The bottom Back/Continue strip for one wizard step. Each step
 * renders this directly from its own derived state — no parent
 * registration, no shared effect, no cross-render coupling.
 */
export function WizardNav({
  step,
  onBack,
  onContinue,
  continueAsFormId,
  continueDisabled,
  customContinueLabel,
}: WizardNavProps) {
  const { t } = useTranslation()
  const nav = getStepNavigation(step)

  // No nav for the first (source) or last (done) terminal steps.
  // Done renders its own Open Group button; source transitions via
  // its own file/URL inputs.
  if (!nav.previousStepKey && !nav.nextStepKey) return null
  if (step === 'done') return null

  const previousStepLabel = nav.previousStepKey
    ? t(STEP_HEADER_LABEL_KEYS[nav.previousStepKey])
    : undefined
  const nextStepLabel = nav.nextStepKey
    ? t(STEP_HEADER_LABEL_KEYS[nav.nextStepKey])
    : undefined

  const backLabel = nav.previousStepKey
    ? t('Groups.Import.StepHeader.backTo', { step: previousStepLabel })
    : undefined
  const continueLabel =
    customContinueLabel !== undefined
      ? t(customContinueLabel)
      : nextStepLabel
        ? t('Groups.Import.StepHeader.continueTo', { step: nextStepLabel })
        : undefined

  const showContinue = continueLabel !== undefined

  return (
    <SharedWizardNav
      {...(nav.previousStepKey && backLabel && onBack
        ? { back: { label: backLabel, onClick: onBack } }
        : {})}
      {...(showContinue && continueLabel
        ? {
            continue: {
              label: continueLabel,
              onClick: continueAsFormId ? undefined : onContinue,
              form: continueAsFormId,
              disabled: continueDisabled,
            },
          }
        : {})}
    />
  )
}
