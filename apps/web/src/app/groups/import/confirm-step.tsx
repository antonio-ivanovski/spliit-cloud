'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { AppRouterOutput } from '@spliit/api/router'
import type { NormalizedSource } from '@spliit/domain/import'
import { AlertCircle, ArrowRightLeft, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ParticipantMappingState } from './import-group-wizard'

type ImportInvite = NonNullable<
  AppRouterOutput['groups']['import']
>['invites'][number]

type RatesStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error' }

export type CurrencyConversionEntry = {
  date: string
  source: string
  target: string
  rate: number
  /**
   * Date the rate provider actually returned. Differs from `date` for
   * future expenses, weekends, and provider outages — the import still
   * applies the returned rate but we surface the gap so the user knows
   * the conversion isn't using the requested day.
   */
  asOfDate: string
}

type Props = {
  source: NormalizedSource
  mode: 'NEW_GROUP' | 'EXISTING_GROUP'
  targetGroupId: string | null
  groupFormValues: {
    name: string
    information: string
    currency: string
    currencyCode: string
  }
  participants: ParticipantMappingState[]
  resolvedExpenses: NormalizedSource['expenses']
  invites?: ImportInvite[]
  isSubmitting: boolean
  /**
   * Cross-currency rate readiness. `idle` means no conversion is
   * needed; `loading`/`error` block the import button so the user
   * can't submit until the rates are ready (or until they go back to
   * fix something upstream).
   */
  ratesStatus: RatesStatus
  /**
   * One row per `(date, source, target)` triple the wizard pre-fetched
   * a rate for. Rendered into the "Currency conversion" card so the
   * user can audit the conversion before submitting.
   */
  currencyConversions: CurrencyConversionEntry[]
  onBack: () => void
  onSubmit: () => void
}

export function ConfirmStep({
  source,
  mode,
  targetGroupId,
  groupFormValues,
  participants,
  resolvedExpenses,
  isSubmitting,
  ratesStatus,
  currencyConversions,
  onBack,
  onSubmit,
}: Props) {
  const { t } = useTranslation()
  const linkedCount = participants.filter(
    (p) => p.mode === 'LINK_ACCOUNT',
  ).length
  const inviteEmailCount = participants.filter(
    (p) => p.mode === 'INVITE_BY_EMAIL',
  ).length
  const inviteLinkCount = participants.filter(
    (p) => p.mode === 'INVITE_BY_LINK',
  ).length
  const unlinkedCount = participants.filter(
    (p) => p.mode === 'UNLINKED_PARTICIPANT',
  ).length

  const importBlocked = ratesStatus.kind === 'error' || isSubmitting
  const importDisabled = importBlocked || ratesStatus.kind === 'loading'

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="p-4 flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">
            {t('Groups.Import.Confirm.destinationLabel')}
          </p>
          <p className="text-lg font-medium">
            {mode === 'NEW_GROUP' ? groupFormValues.name : targetGroupId}
          </p>
          <p className="text-xs text-muted-foreground">
            {mode === 'NEW_GROUP'
              ? t('Groups.Import.Confirm.newGroupFormat', {
                  currency:
                    groupFormValues.currencyCode || groupFormValues.currency,
                })
              : t('Groups.Import.Confirm.existingGroupFormat')}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">
            {t('Groups.Import.Confirm.summaryLabel')}
          </p>
          <ul className="text-sm mt-1 space-y-1">
            <li>
              {t('Groups.Import.Confirm.sourceParticipants', {
                count: participants.length,
              })}
            </li>
            <li>
              {t('Groups.Import.Confirm.participantBreakdown', {
                linked: linkedCount,
                email: inviteEmailCount,
                link: inviteLinkCount,
                unlinked: unlinkedCount,
              })}
            </li>
            <li>
              {t('Groups.Import.Confirm.expenseCount', {
                count: resolvedExpenses.length,
              })}
            </li>
            <li>
              {t('Groups.Import.Confirm.sourceName', { name: source.name })}
            </li>
          </ul>
        </CardContent>
      </Card>

      {currencyConversions.length > 0 && (
        <Card>
          <CardContent className="p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <ArrowRightLeft
                className="h-4 w-4 text-muted-foreground shrink-0"
                aria-hidden
              />
              <p className="text-sm font-medium">
                {t('Groups.Import.Confirm.currencyConversionTitle')}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('Groups.Import.Confirm.currencyConversionDescription')}
            </p>
            <ul className="text-sm mt-1 space-y-1.5">
              {currencyConversions.map((entry, idx) => {
                const requestedAsOfMismatch = entry.asOfDate !== entry.date
                return (
                  <li
                    key={`${entry.date}-${entry.source}-${entry.target}-${idx}`}
                    className="flex flex-col gap-0.5"
                  >
                    <span className="font-mono text-sm">
                      {t('Groups.Import.Confirm.currencyRateFormat', {
                        source: entry.source,
                        rate: entry.rate,
                        target: entry.target,
                      })}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {requestedAsOfMismatch
                        ? t('Groups.Import.Confirm.currencyRateAsOfFormat', {
                            requested: entry.date,
                            asOf: entry.asOfDate,
                          })
                        : t('Groups.Import.Confirm.currencyRateForDateFormat', {
                            date: entry.date,
                          })}
                    </span>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {ratesStatus.kind === 'loading' && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          <p>{t('Groups.Import.Confirm.ratesLoading')}</p>
        </div>
      )}

      {ratesStatus.kind === 'error' && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <p>{t('Groups.Import.Confirm.rateFetchError')}</p>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {t('Groups.Import.Confirm.footer')}
      </p>

      <div className="flex justify-end gap-2">
        <Button onClick={onSubmit} disabled={importDisabled}>
          {isSubmitting
            ? t('Groups.Import.Confirm.importingButton')
            : t('Groups.Import.Confirm.importButton')}
        </Button>
      </div>
    </div>
  )
}
