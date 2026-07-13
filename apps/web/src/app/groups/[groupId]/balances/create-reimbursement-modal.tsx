import { CategoryIcon } from '@/app/groups/[groupId]/expenses/category-icon'
import { useCreateExpenseMutation } from '@/app/groups/[groupId]/expenses/expense-mutation-hooks'
import { categoryLabel } from '@/app/groups/[groupId]/stats/category-utils'
import { ParticipantAvatar } from '@/components/participant-avatar'
import { Button } from '@/components/ui/button'
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
import type { Reimbursement } from '@/lib/balances'
import type { Currency } from '@/lib/currency'
import {
  formatCurrency,
  formatDateOnly,
  getCurrencyFromGroup,
} from '@/lib/utils'
import { trpc } from '@/trpc/client'
import { PAYMENT_CATEGORY_ID, RecurrenceRule } from '@spliit/domain'
import { useNavigate } from '@tanstack/react-router'
import { Check, Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCurrentGroup, useIsPendingInvitee } from '../current-group-context'
import { useLinkInviteToken } from '../use-link-invite-token'

type CreateReimbursementModalProps = {
  groupId: string
  reimbursement: Reimbursement | null
  currency: Currency
  originalCurrencyCode?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateReimbursementModal({
  groupId,
  reimbursement,
  currency,
  originalCurrencyCode,
  open,
  onOpenChange,
}: CreateReimbursementModalProps) {
  const { group } = useCurrentGroup()
  const isPendingInvitee = useIsPendingInvitee()
  const linkInviteToken = useLinkInviteToken()
  const locale = useLocale()
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const { toast } = useToast()
  const { t } = useTranslation(undefined, { keyPrefix: 'CreateReimbursement' })
  const { t: tForm } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const { t: tCategories } = useTranslation(undefined, {
    keyPrefix: 'Categories',
  })

  const groupCurrency = group ? getCurrencyFromGroup(group) : undefined
  const participants = group?.participants ?? []
  const fromParticipant = reimbursement
    ? participants.find((p) => p.id === reimbursement.from)
    : undefined
  const toParticipant = reimbursement
    ? participants.find((p) => p.id === reimbursement.to)
    : undefined
  const canCreate = Boolean(
    reimbursement && group && !group.archived && !isPendingInvitee,
  )
  const needsConversion =
    !!reimbursement &&
    !!groupCurrency &&
    !!originalCurrencyCode &&
    originalCurrencyCode !== groupCurrency.code

  const { mutateAsync: createExpenseMutateAsync, isPending } =
    useCreateExpenseMutation({ linkInviteToken })

  const handleOpenChange = (nextOpen: boolean) => {
    if (isPending) return
    onOpenChange(nextOpen)
  }

  const handleEdit = () => {
    if (!reimbursement) return
    onOpenChange(false)
    navigate({
      to: '/groups/$groupId/expenses/create',
      params: { groupId },
      search: {
        reimbursement: 'yes',
        from: reimbursement.from,
        to: reimbursement.to,
        amount: reimbursement.amount.toString(),
        ...(originalCurrencyCode
          ? { originalCurrency: originalCurrencyCode }
          : {}),
      },
    })
  }

  const handleCreate = async () => {
    if (!reimbursement) return
    await createExpenseMutateAsync({
      groupId,
      expense: {
        expenseDate: new Date(),
        title: tForm('reimbursement'),
        category: PAYMENT_CATEGORY_ID,
        amount: reimbursement.amount,
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [
          { participant: reimbursement.from, shares: reimbursement.amount },
        ],
        splitMode: 'EVENLY',
        paidFor: [{ participant: reimbursement.to, shares: 1 }],
        isMultiPayer: false,
        isReimbursement: true,
        documents: [],
        recurrenceRule: RecurrenceRule.NONE,
        ...(needsConversion && originalCurrencyCode
          ? {
              conversion: {
                type: 'exchange',
                currency: originalCurrencyCode,
              },
            }
          : {}),
      },
    })
    toast({ description: t('successToast') })
    onOpenChange(false)
    await utils.groups.balances.invalidate()
  }

  if (!reimbursement) {
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
              category={{
                grouping: 'Uncategorized',
                name: 'Payment',
              }}
              className="h-5 w-5 shrink-0 text-muted-foreground"
            />
            <span className="truncate">{tForm('reimbursement')}</span>
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t('description')}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody className="max-h-[70vh] space-y-5 overflow-y-auto">
          <div>
            <div className="text-3xl font-bold tabular-nums tracking-tight">
              {formatCurrency(currency, reimbursement.amount, locale)}
            </div>
          </div>

          <div className="space-y-4 border-t pt-4">
            <div className="text-sm text-muted-foreground">
              {t('pays', {
                from: fromParticipant?.name ?? '',
                to: toParticipant?.name ?? '',
              })}
            </div>
            <div className="flex items-center gap-3">
              {fromParticipant && (
                <div className="flex items-center gap-2">
                  <ParticipantAvatar
                    participant={fromParticipant}
                    size="sm"
                    className="shrink-0"
                  />
                  <span className="text-sm font-medium">
                    {fromParticipant.name}
                  </span>
                </div>
              )}
              {fromParticipant && toParticipant && (
                <span aria-hidden="true" className="text-muted-foreground">
                  →
                </span>
              )}
              {toParticipant && (
                <div className="flex items-center gap-2">
                  <ParticipantAvatar
                    participant={toParticipant}
                    size="sm"
                    className="shrink-0"
                  />
                  <span className="text-sm font-medium">
                    {toParticipant.name}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="text-sm text-muted-foreground">
            {t('date')}:{' '}
            <span className="text-foreground">
              {formatDateOnly(new Date(), locale, { dateStyle: 'medium' })}
            </span>
          </div>

          <div className="text-sm text-muted-foreground">
            {t('category')}:{' '}
            <span className="text-foreground">
              {categoryLabel(tCategories, PAYMENT_CATEGORY_ID)}
            </span>
          </div>
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter className="flex-row gap-2 sm:justify-end">
          {canCreate && (
            <>
              <Button
                type="button"
                variant="outline"
                className="flex-1 sm:flex-none"
                onClick={handleEdit}
                disabled={isPending}
                data-testid="reimbursement-edit"
              >
                <Pencil className="mr-2 h-4 w-4" />
                {t('edit')}
              </Button>
              <Button
                type="button"
                className="flex-1 sm:flex-none"
                onClick={handleCreate}
                disabled={isPending}
                data-testid="reimbursement-create"
              >
                <Check className="mr-2 h-4 w-4" />
                {isPending ? t('creating') : t('create')}
              </Button>
            </>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
