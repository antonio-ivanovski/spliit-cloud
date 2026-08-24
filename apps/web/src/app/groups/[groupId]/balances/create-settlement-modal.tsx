/* oxlint-disable jsx-a11y/prefer-tag-over-role -- labeled checkbox groups use explicit ARIA semantics. */
import { Link } from '@tanstack/react-router'
import { Check, Pencil } from 'lucide-react'
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'

import { CategoryIcon } from '@/app/groups/[groupId]/expenses/category-icon'
import { useCreateExpenseMutation } from '@/app/groups/[groupId]/expenses/expense-mutation-hooks'
import { categoryLabel } from '@/app/groups/[groupId]/stats/category-utils'
import { useSyncedAccountPreferences } from '@/components/account-preferences-sync'
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
import { useToast } from '@/components/ui/use-toast'
import { useLocale } from '@/i18n/react'
import { detectDeviceTimeZone } from '@/lib/account-preferences'
import type { SuggestedSettlement } from '@/lib/balances'
import type { Currency } from '@/lib/currency'
import { useIdempotentCreate } from '@/lib/use-idempotent-create'
import {
  dateOnlyInAccountTimeZone,
  formatCurrency,
  formatDateOnly,
  getCurrencyFromGroup,
} from '@/lib/utils'
import { trpc } from '@/trpc/client'
import { SETTLEMENT_CATEGORY_ID } from '@spliit/domain'

import {
  useCurrentGroup,
  useIsReadOnlyGroupViewer,
} from '../current-group-context'
import { RemovedParticipantBadge } from './removed-participant-badge'
import {
  settlementLegKey,
  sumSettlementLegs,
  type SettlementDirection,
  type SettlementGroup,
} from './settlement-groups'
import { SettlementAvatar } from './settlement-ui'

type CreateSettlementModalProps = {
  groupId: string
  /** Kept for the existing single-leg entry point. */
  settlement?: SuggestedSettlement | null
  settlementGroup?: SettlementGroup
  initialSelectedKeys?: string[]
  currency: Currency
  originalCurrencyCode?: string
  /**
   * Prefer passing the balances-page merged list (includes soft-removed
   * participants). Falls back to group.participants when omitted.
   */
  participants?: Array<{
    id: string
    name: string
    account?: { id: string; name?: string | null; image?: string | null } | null
    removed?: boolean
  }>
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateSettlementModal({
  groupId,
  settlement,
  settlementGroup,
  initialSelectedKeys,
  currency,
  originalCurrencyCode,
  participants: participantsProp,
  open,
  onOpenChange,
}: CreateSettlementModalProps) {
  const { group } = useCurrentGroup()
  const isReadOnlyGroupViewer = useIsReadOnlyGroupViewer()
  const locale = useLocale()
  const accountPreferences = useSyncedAccountPreferences()
  const accountTimeZone =
    accountPreferences?.timeZone ?? detectDeviceTimeZone() ?? 'UTC'
  const today = dateOnlyInAccountTimeZone(new Date(), accountTimeZone)
  const utils = trpc.useUtils()
  const { toast } = useToast()
  const { t } = useTranslation(undefined, { keyPrefix: 'CreateSettlement' })
  const { t: tForm } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const { t: tCategories } = useTranslation(undefined, {
    keyPrefix: 'Categories',
  })

  const groupCurrency = group ? getCurrencyFromGroup(group) : undefined
  const participants = (participantsProp ?? group?.participants ?? []).map(
    (participant) => ({
      id: participant.id,
      name: participant.name,
      account: participant.account,
      removed: 'removed' in participant ? Boolean(participant.removed) : false,
    }),
  )
  const legs = settlementGroup?.legs ?? (settlement ? [settlement] : [])
  const direction: SettlementDirection = settlementGroup?.direction ?? 'pay'
  const centralParticipantId =
    settlementGroup?.participantId ?? settlement?.from
  const centralParticipant = participants.find(
    (participant) => participant.id === centralParticipantId,
  )
  const legKeys = legs.map(settlementLegKey).join('|')
  const defaultSelectedKeys =
    initialSelectedKeys ?? legs.map((leg) => settlementLegKey(leg))
  const defaultSelectedValue = defaultSelectedKeys.join('|')
  const [selectedKeys, setSelectedKeys] = useState(defaultSelectedKeys)
  const selectedKeySet = new Set(selectedKeys)
  const selectedLegs = legs.filter((leg) =>
    selectedKeySet.has(settlementLegKey(leg)),
  )
  const summaryLeg = selectedLegs[0] ?? legs[0]
  const selectedTotal = sumSettlementLegs(selectedLegs)
  const isLegacySingle = !settlementGroup && selectedLegs.length === 1
  const canCreate = Boolean(
    legs.length > 0 && group && !group.archived && !isReadOnlyGroupViewer,
  )
  const needsConversion =
    legs.length > 0 &&
    !!groupCurrency &&
    !!originalCurrencyCode &&
    originalCurrencyCode !== groupCurrency.code

  const { mutateAsync: createExpenseMutateAsync, isPending } =
    useCreateExpenseMutation()
  const createAttempt = useIdempotentCreate()

  useEffect(() => {
    if (open) {
      // oxlint-disable-next-line react/react-compiler -- initialize selection from the controlled default when opened.
      setSelectedKeys(
        (defaultSelectedValue ? defaultSelectedValue.split('|') : []).filter(
          Boolean,
        ),
      )
    }
  }, [defaultSelectedValue, legKeys, open])

  const handleOpenChange = (nextOpen: boolean) => {
    if (isPending) return
    onOpenChange(nextOpen)
  }

  const editSearch =
    selectedLegs.length === 0
      ? undefined
      : selectedLegs.length > 1 && settlementGroup
        ? {
            settlement: 'yes' as const,
            amount: selectedTotal.toString(),
            settlements: JSON.stringify({
              direction,
              participantId: centralParticipantId,
              legs: selectedLegs,
            }),
            ...(originalCurrencyCode
              ? { originalCurrency: originalCurrencyCode }
              : {}),
          }
        : {
            settlement: 'yes' as const,
            from: selectedLegs[0]!.from,
            to: selectedLegs[0]!.to,
            amount: selectedLegs[0]!.amount.toString(),
            ...(originalCurrencyCode
              ? { originalCurrency: originalCurrencyCode }
              : {}),
          }

  const handleCreate = async () => {
    if (selectedLegs.length === 0 || !centralParticipantId) return
    const expenseDate = new Date()

    const paidByList =
      direction === 'pay'
        ? [{ participant: centralParticipantId, shares: selectedTotal }]
        : selectedLegs.map((leg) => ({
            participant: leg.from,
            shares: leg.amount,
          }))
    const paidFor = isLegacySingle
      ? [{ participant: selectedLegs[0].to, shares: 1 }]
      : direction === 'pay'
        ? selectedLegs.map((leg) => ({
            participant: leg.to,
            shares: leg.amount,
          }))
        : [{ participant: centralParticipantId, shares: selectedTotal }]

    const result = await createAttempt.run((requestId) =>
      createExpenseMutateAsync({
        groupId,
        requestId,
        expense: {
          expenseDate,
          expenseTimeZone: accountTimeZone,
          title: tForm('settlementTitle'),
          category: SETTLEMENT_CATEGORY_ID,
          amount: selectedTotal,
          paidBySplitMode: 'BY_AMOUNT',
          paidByList,
          splitMode: isLegacySingle ? 'EVENLY' : 'BY_AMOUNT',
          paidFor,
          isMultiPayer: direction === 'receive' && paidByList.length > 1,
          documents: [],
          recurrence: null,
          ...(needsConversion && originalCurrencyCode
            ? {
                conversion: {
                  type: 'exchange',
                  currency: originalCurrencyCode,
                },
              }
            : {}),
        },
      }),
    )
    if (!result) return
    toast({
      description:
        selectedLegs.length > 1
          ? t('successToastMultiple', { count: selectedLegs.length })
          : t('successToast'),
      variant: 'success',
    })
    onOpenChange(false)
    await utils.groups.balances.invalidate()
  }

  if (legs.length === 0) {
    return (
      <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
        <ResponsiveDialogContent className="max-w-lg" />
      </ResponsiveDialog>
    )
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent className="max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <CategoryIcon
              category={{ grouping: 'Settlement', name: 'Settlement' }}
              className="h-5 w-5 shrink-0 text-muted-foreground"
            />
            <span className="truncate">{tForm('settlementTitle')}</span>
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t('description')}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody className="max-h-[70vh] space-y-5 overflow-y-auto">
          <div className="text-3xl font-bold tracking-tight tabular-nums">
            {formatCurrency(currency, selectedTotal, locale)}
          </div>

          <div className="space-y-4 border-t pt-4">
            <div className="text-sm text-muted-foreground">
              {selectedLegs.length > 1
                ? direction === 'pay'
                  ? t('paysMany', {
                      from: centralParticipant?.name ?? '',
                      count: selectedLegs.length,
                    })
                  : t('receivesMany', {
                      to: centralParticipant?.name ?? '',
                      count: selectedLegs.length,
                    })
                : t('pays', {
                    from:
                      participants.find(
                        (participant) => participant.id === summaryLeg?.from,
                      )?.name ?? '',
                    to:
                      participants.find(
                        (participant) => participant.id === summaryLeg?.to,
                      )?.name ?? '',
                  })}
            </div>
            <SettlementSelectionList
              legs={legs}
              direction={direction}
              participants={participants}
              centralParticipant={centralParticipant}
              currency={currency}
              locale={locale}
              selectedKeySet={selectedKeySet}
              setSelectedKeys={setSelectedKeys}
            />
            <div className="flex items-center gap-3">
              {centralParticipant && (
                <div className="flex items-center gap-2">
                  <SettlementAvatar
                    members={[centralParticipant]}
                    label={centralParticipant.name}
                    size="sm"
                  />
                  <span className="text-sm font-medium">
                    {centralParticipant.name}
                  </span>
                  {centralParticipant.removed ? (
                    <RemovedParticipantBadge />
                  ) : null}
                </div>
              )}
              {selectedLegs.length === 1 && (
                <>
                  <span aria-hidden="true" className="text-muted-foreground">
                    {direction === 'pay' ? '→' : '←'}
                  </span>
                  {(() => {
                    const other = participants.find(
                      (participant) =>
                        participant.id ===
                        (direction === 'pay'
                          ? selectedLegs[0].to
                          : selectedLegs[0].from),
                    )
                    return (
                      <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium">
                        {other && (
                          <SettlementAvatar
                            members={[other]}
                            label={other.name}
                            size="sm"
                          />
                        )}
                        <span className="truncate">{other?.name ?? ''}</span>
                        {other?.removed ? <RemovedParticipantBadge /> : null}
                      </span>
                    )
                  })()}
                </>
              )}
            </div>
            <div className="sr-only" aria-live="polite">
              {t('selectionSummary', {
                count: selectedLegs.length,
                total: formatCurrency(currency, selectedTotal, locale),
              })}
            </div>
          </div>

          <div className="text-sm text-muted-foreground">
            {t('date')}:{' '}
            <span className="text-foreground">
              {formatDateOnly(today, locale, { dateStyle: 'medium' })}
            </span>
          </div>

          <div className="text-sm text-muted-foreground">
            {t('category')}:{' '}
            <span className="text-foreground">
              {categoryLabel(tCategories, SETTLEMENT_CATEGORY_ID)}
            </span>
          </div>
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter className="flex-row gap-2 sm:justify-end">
          {canCreate && (
            <>
              <Button
                variant="outline"
                className="flex-1 sm:flex-none"
                disabled={isPending || selectedLegs.length === 0}
                nativeButton={!editSearch}
                render={
                  editSearch ? (
                    <Link
                      to="/groups/$groupId/expenses/create"
                      params={{ groupId }}
                      search={editSearch}
                    />
                  ) : undefined
                }
                onClick={() => onOpenChange(false)}
                data-testid="settlement-edit"
              >
                <Pencil className="me-2 h-4 w-4" />
                {t('edit')}
              </Button>
              <Button
                type="button"
                className="flex-1 sm:flex-none"
                onClick={handleCreate}
                disabled={isPending || selectedLegs.length === 0}
                data-testid="settlement-create"
              >
                <Check className="me-2 h-4 w-4" />
                {isPending
                  ? t('creating')
                  : selectedLegs.length === 1
                    ? t('createSingle')
                    : t('createMultiple', { count: selectedLegs.length })}
              </Button>
            </>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

function SettlementSelectionList({
  legs,
  direction,
  participants,
  centralParticipant,
  currency,
  locale,
  selectedKeySet,
  setSelectedKeys,
}: {
  legs: SuggestedSettlement[]
  direction: SettlementDirection
  participants: Array<{ id: string; name: string; removed?: boolean }>
  centralParticipant?: { id: string; name: string; removed?: boolean }
  currency: Currency
  locale: string
  selectedKeySet: Set<string>
  setSelectedKeys: Dispatch<SetStateAction<string[]>>
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'CreateSettlement' })
  return (
    <div className="space-y-2" role="group" aria-label={t('paymentsToInclude')}>
      {legs.map((leg) => {
        const key = settlementLegKey(leg)
        const counterpartyId = direction === 'pay' ? leg.to : leg.from
        const counterparty = participants.find(
          (participant) => participant.id === counterpartyId,
        )
        return (
          <label
            key={key}
            htmlFor={`settlement-${key}`}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border/70 px-3 py-2 transition-colors hover:bg-muted/50"
          >
            <Checkbox
              id={`settlement-${key}`}
              checked={selectedKeySet.has(key)}
              onCheckedChange={(checked) => {
                setSelectedKeys((current) =>
                  checked
                    ? [...new Set([...current, key])]
                    : current.filter((item) => item !== key),
                )
              }}
              aria-label={
                direction === 'pay'
                  ? t('legToAria', {
                      from: centralParticipant?.name ?? '',
                      to: counterparty?.name ?? '',
                      amount: formatCurrency(currency, leg.amount, locale),
                    })
                  : t('legFromAria', {
                      from: counterparty?.name ?? '',
                      to: centralParticipant?.name ?? '',
                      amount: formatCurrency(currency, leg.amount, locale),
                    })
              }
              data-testid={`settlement-select-${key}`}
            />
            {counterparty && (
              <SettlementAvatar
                members={[counterparty]}
                label={counterparty.name}
                size="sm"
              />
            )}
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {direction === 'pay'
                ? t('toParticipant', { name: counterparty?.name ?? '' })
                : t('fromParticipant', {
                    name: counterparty?.name ?? '',
                  })}
            </span>
            {counterparty?.removed ? <RemovedParticipantBadge /> : null}
            <span className="shrink-0 text-sm tabular-nums">
              {formatCurrency(currency, leg.amount, locale)}
            </span>
          </label>
        )
      })}
    </div>
  )
}
