import { AppliedExchangeRates } from '@/components/applied-exchange-rates'
import { Card, CardContent } from '@/components/ui/card'
import type { AppRouterOutput } from '@spliit/api/router'
import type { NormalizedSource } from '@spliit/domain/import'
import { useTranslation } from 'react-i18next'
import type {
  ConversionMode,
  ParticipantMappingState,
} from './import-wizard-state'
import { WizardNav } from './wizard-nav'

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
  onBack: () => void
  onSubmit: () => void
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
  onBack,
  onSubmit,
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

  const conversionPairs = Object.keys(conversionModes)

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
        <AppliedExchangeRates modes={conversionModes} rates={rates} />
      )}

      <p className="text-xs text-muted-foreground">
        {t('Groups.Import.Confirm.footer')}
      </p>

      <WizardNav
        step="confirm"
        onBack={onBack}
        onContinue={onSubmit}
        continueDisabled={isSubmitting}
        customContinueLabel={
          isSubmitting
            ? 'Groups.Import.Confirm.importingButton'
            : 'Groups.Import.Confirm.executeImport'
        }
      />
    </div>
  )
}
