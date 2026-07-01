import { Card, CardContent } from '@/components/ui/card'
import type { AppRouterOutput } from '@spliit/api/router'
import type { NormalizedSource } from '@spliit/domain/import'
import { Calendar, Globe } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ConversionMode,
  ParticipantMappingState,
  StepNavRegistration,
} from './import-wizard-state'

type ImportInvite = NonNullable<
  AppRouterOutput['groups']['import']
>['invites'][number]

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
  conversionModes: Record<string, ConversionMode>
  rates: Record<string, number> | null | undefined
  onSubmit: () => void
  registerStepNav: (
    step: 'confirm',
    nav: Pick<
      StepNavRegistration,
      'onContinue' | 'disabled' | 'customContinueLabel'
    >,
  ) => void
}

function formatRate(n: number): string {
  return n.toFixed(4)
}

export function ConfirmStep({
  source,
  mode,
  groupFormValues,
  participants,
  resolvedExpenses,
  isSubmitting,
  conversionModes,
  rates,
  onSubmit,
  registerStepNav,
}: Props) {
  const { t } = useTranslation()
  const linkedCount = participants.filter(
    (p) => p.mode === 'LINK_ACCOUNT',
  ).length
  const inviteLinkCount = participants.filter(
    (p) => p.mode === 'INVITE_BY_LINK',
  ).length
  const inviteEmailCount = participants.filter(
    (p) => p.mode === 'INVITE_BY_EMAIL',
  ).length
  const existingCount = participants.filter(
    (p) => p.mode === 'LINK_EXISTING_PARTICIPANT',
  ).length
  const unlinkedCount = participants.filter(
    (p) => p.mode === 'UNLINKED_PARTICIPANT',
  ).length

  // Group rates by pair ("BASE|TARGET") so the confirm card can render one
  // block per pair with its mode + entries.
  type RateRow = { date: string; rate: number }
  const ratesByPair: Record<string, RateRow[]> = {}
  if (rates) {
    for (const key of Object.keys(rates)) {
      const [date, base, target] = key.split('|')
      const pairKey = `${base}|${target}`
      const list = ratesByPair[pairKey] ?? (ratesByPair[pairKey] = [])
      list.push({ date, rate: rates[key] })
    }
  }
  // Stable order by date within each pair.
  for (const key of Object.keys(ratesByPair)) {
    ratesByPair[key].sort((a, b) => a.date.localeCompare(b.date))
  }
  const conversionPairs = Object.keys(conversionModes)

  useEffect(() => {
    registerStepNav('confirm', {
      onContinue: onSubmit,
      disabled: isSubmitting,
      customContinueLabel: isSubmitting
        ? 'Groups.Import.Confirm.importingButton'
        : 'Groups.Import.Confirm.executeImport',
    })
  }, [onSubmit, isSubmitting, registerStepNav])

  return (
    <div className="flex flex-col gap-6">
      {/* Destination */}
      <Card>
        <CardContent className="flex flex-col gap-2 p-4">
          <p className="text-sm font-medium">
            {t('Groups.Import.Confirm.destinationLabel')}
          </p>
          <p className="text-sm text-muted-foreground">
            {mode === 'EXISTING_GROUP'
              ? t('Groups.Import.Confirm.existingGroupFormat')
              : t('Groups.Import.Confirm.newGroupFormat', {
                  name: groupFormValues.name,
                  currency: groupFormValues.currencyCode,
                })}
          </p>
        </CardContent>
      </Card>

      {/* Summary */}
      <Card>
        <CardContent className="flex flex-col gap-2 p-4">
          <p className="text-sm font-medium">
            {t('Groups.Import.Confirm.summaryLabel')}
          </p>
          <ul className="space-y-2 text-sm">
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
                existing: existingCount,
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

      {/* Conversion summary */}
      {conversionPairs.length > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-4">
            <p className="text-sm font-medium">
              {t('Groups.Import.Confirm.appliedExchangeRatesLabel')}
            </p>
            <ul className="flex flex-col gap-3 text-sm">
              {conversionPairs.map((pairKey) => {
                const [base, target] = pairKey.split('|')
                const pairMode = conversionModes[pairKey]
                const isPerDate = pairMode === 'perDate'
                const rows = ratesByPair[pairKey] ?? []
                return (
                  <li key={pairKey} className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2 text-foreground">
                      {isPerDate ? (
                        <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="font-medium tracking-tight">
                        {t('Groups.Import.CurrencyConversion.pairSection', {
                          source: base,
                          target,
                        })}
                      </span>
                      <span className="ml-auto rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        {isPerDate
                          ? t('Groups.Import.Confirm.conversionPerDate')
                          : t('Groups.Import.Confirm.conversionFixed')}
                      </span>
                    </div>
                    {isPerDate ? (
                      rows.length > 0 ? (
                        <ul className="ml-6 flex flex-col gap-1 text-xs">
                          {rows.map((row) => (
                            <li
                              key={row.date}
                              className="flex items-baseline gap-3 text-muted-foreground"
                            >
                              <span className="font-mono tabular-nums">
                                {row.date}
                              </span>
                              <span className="font-mono tabular-nums text-foreground">
                                {t(
                                  'Groups.Import.CurrencyConversion.fixedRateRow',
                                  {
                                    source: base,
                                    rate: formatRate(row.rate),
                                    target,
                                  },
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="ml-6 text-xs text-muted-foreground">—</p>
                      )
                    ) : rows.length > 0 ? (
                      <p className="ml-6 font-mono text-xs tabular-nums text-foreground">
                        {t('Groups.Import.CurrencyConversion.fixedRateRow', {
                          source: base,
                          rate: formatRate(rows[0].rate),
                          target,
                        })}
                      </p>
                    ) : (
                      <p className="ml-6 text-xs text-muted-foreground">—</p>
                    )}
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        {t('Groups.Import.Confirm.footer')}
      </p>
    </div>
  )
}
