'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { AppRouterOutput } from '@spliit/api/router'
import type { NormalizedSource } from '@spliit/domain/import'
import { useTranslation } from 'react-i18next'
import type { ParticipantMappingState } from './import-group-wizard'

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

      <p className="text-xs text-muted-foreground">
        {t('Groups.Import.Confirm.footer')}
      </p>

      <div className="flex justify-end gap-2">
        <Button onClick={onSubmit} disabled={isSubmitting}>
          {isSubmitting
            ? t('Groups.Import.Confirm.importingButton')
            : t('Groups.Import.Confirm.importButton')}
        </Button>
      </div>
    </div>
  )
}
