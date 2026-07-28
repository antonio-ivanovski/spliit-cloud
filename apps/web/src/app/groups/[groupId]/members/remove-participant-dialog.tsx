import { useTranslation } from 'react-i18next'

import { ParticipantAvatar } from '@/components/participant-avatar'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale } from '@/i18n/react'
import { formatCurrency, getCurrencyFromGroup } from '@/lib/utils'

import {
  settlementLegKey,
  sumSettlementLegs,
} from '../balances/settlement-groups'
import { useCurrentGroup } from '../current-group-context'

type SettlementLeg = {
  from: string
  to: string
  amount: number
}

type RemovePreview = {
  participantName: string
  participantKind: 'member' | 'invitation' | 'unlinked'
  hasUnsettledBalance: boolean
  currentBalance: number
  settlementLegs: SettlementLeg[]
  currencyCode: string | null
  participants: Array<{ id: string; name: string }>
}

export function RemoveParticipantDialog({
  participantPendingRemove,
  removePreviewQuery,
  participantRemoveSettleChecked,
  removeParticipantMutation,
  onOpenChange,
  onConfirmRemove,
  onSettleCheckedChange,
}: {
  participantPendingRemove: {
    ledgerParticipantId: string
    name: string
  } | null
  removePreviewQuery: {
    data?: RemovePreview | null
    isLoading: boolean
  }
  participantRemoveSettleChecked: boolean
  removeParticipantMutation: { isPending: boolean }
  onOpenChange: (open: boolean) => void
  onConfirmRemove: (settleBalances?: boolean) => void
  onSettleCheckedChange: (checked: boolean) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  const locale = useLocale()
  const { group } = useCurrentGroup()
  const currency = group ? getCurrencyFromGroup(group) : undefined
  const preview = removePreviewQuery.data
  const isPending = removeParticipantMutation.isPending
  const canConfirm =
    !!preview &&
    !removePreviewQuery.isLoading &&
    !isPending &&
    (!preview.hasUnsettledBalance || participantRemoveSettleChecked)

  const leavingParticipantId =
    participantPendingRemove?.ledgerParticipantId ?? null
  const settlementLegs = preview?.settlementLegs ?? []
  const showSettlementPreview =
    !!preview?.hasUnsettledBalance &&
    participantRemoveSettleChecked &&
    settlementLegs.length > 0 &&
    !!leavingParticipantId &&
    !!currency

  const settlementDirection = settlementLegs.some(
    (leg) => leg.from === leavingParticipantId,
  )
    ? 'pay'
    : 'receive'
  const settlementTotal = sumSettlementLegs(settlementLegs)
  const leavingName =
    preview?.participants.find((p) => p.id === leavingParticipantId)?.name ??
    preview?.participantName ??
    participantPendingRemove?.name ??
    ''

  function handleOpenChange(open: boolean) {
    if (!open) {
      onSettleCheckedChange(false)
    }
    onOpenChange(open)
  }

  return (
    <ResponsiveDialog
      open={!!participantPendingRemove}
      onOpenChange={handleOpenChange}
    >
      <ResponsiveDialogContent className="max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {participantPendingRemove ? (
              <>
                {t('removeDialog.title')} · {participantPendingRemove.name}
              </>
            ) : (
              t('removeDialog.title')
            )}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {participantPendingRemove
              ? t('removeDialog.description', {
                  name: participantPendingRemove.name,
                })
              : null}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody className="space-y-4">
          {removePreviewQuery.isLoading || !preview ? (
            <div className="flex flex-col gap-2 py-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : preview.hasUnsettledBalance ? (
            <>
              <label className="flex cursor-pointer items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
                <Checkbox
                  checked={participantRemoveSettleChecked}
                  onCheckedChange={(checked) =>
                    onSettleCheckedChange(checked === true)
                  }
                  disabled={isPending}
                  className="mt-0.5"
                />
                <span>{t('removeDialog.unsettled.checkbox')}</span>
              </label>

              {showSettlementPreview && currency ? (
                <div className="space-y-3 rounded-md border border-border/70 p-3">
                  <div className="text-sm text-muted-foreground">
                    {t('removeDialog.unsettled.previewWillCreate', {
                      count: settlementLegs.length,
                    })}
                  </div>
                  <div className="text-2xl font-bold tracking-tight tabular-nums">
                    {formatCurrency(currency, settlementTotal, locale)}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {settlementDirection === 'pay'
                      ? t('removeDialog.unsettled.previewPays', {
                          name: leavingName,
                        })
                      : t('removeDialog.unsettled.previewReceives', {
                          name: leavingName,
                        })}
                  </div>
                  <div className="space-y-2">
                    {settlementLegs.map((leg) => {
                      const counterpartyId =
                        settlementDirection === 'pay' ? leg.to : leg.from
                      const counterparty = preview.participants.find(
                        (participant) => participant.id === counterpartyId,
                      )
                      return (
                        <div
                          key={settlementLegKey(leg)}
                          className="flex min-h-11 items-center gap-3 rounded-md border border-border/70 px-3 py-2"
                        >
                          {counterparty ? (
                            <ParticipantAvatar
                              participant={counterparty}
                              size="sm"
                              className="shrink-0"
                            />
                          ) : null}
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            {settlementDirection === 'pay'
                              ? t('removeDialog.unsettled.previewTo', {
                                  name: counterparty?.name ?? '',
                                })
                              : t('removeDialog.unsettled.previewFrom', {
                                  name: counterparty?.name ?? '',
                                })}
                          </span>
                          <span className="shrink-0 text-sm tabular-nums">
                            {formatCurrency(currency, leg.amount, locale)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter>
          <Button
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={isPending}
          >
            {t('removeDialog.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={() =>
              onConfirmRemove(
                preview?.hasUnsettledBalance
                  ? participantRemoveSettleChecked
                  : undefined,
              )
            }
            disabled={!canConfirm}
          >
            {t('removeDialog.confirm')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
