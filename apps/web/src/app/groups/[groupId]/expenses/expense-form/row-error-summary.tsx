import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import type { RowShareError } from './get-row-share-errors'

/**
 * Compact list of per-row share errors rendered above the participant rows.
 *
 * The schema reports the array-level sum issue (`amountSum` / `percentageSum`)
 * at the `paidFor` / `paidByList` root, which replaces the row-level error
 * subtree in RHF's error tree. The row summary restores the per-row context
 * (which participant is wrong and why) computed from the live form values.
 *
 * Deliberately not a live region: it recomputes from live values on every
 * validation pass, so an assertive role would re-announce while typing. Field
 * level errors are announced through the row inputs' `aria-describedby`
 * instead; the summary renders once the card was touched or the form submitted
 * (see the paid-for / paid-by cards).
 */
export function RowErrorSummary({
  errors,
  participantName,
  className,
}: {
  errors: RowShareError[]
  participantName: (participantId: string) => string
  className?: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'SchemaErrors' })

  if (errors.length === 0) return null

  return (
    <div
      className={cn(
        'mb-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive',
        className,
      )}
    >
      <p className="font-medium">{t('rowErrorsHeading')}</p>
      <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs">
        {errors.map((error) => (
          <li key={error.participantId}>
            {participantName(error.participantId)}
            {' — '}
            {t(error.messageKey)}
          </li>
        ))}
      </ul>
    </div>
  )
}
