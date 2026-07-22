import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { RuntimeFeatureFlags } from '@/lib/featureFlags'
import { trpc } from '@/trpc/client'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsPendingInvitee } from '../current-group-context'
import { useLinkInviteToken } from '../use-link-invite-token'
import { ExpenseForm } from './expense-form'
import {
  useDeleteExpenseMutation,
  useUpdateExpenseMutation,
} from './expense-mutation-hooks'
import {
  SeriesScopeDialog,
  type SeriesMutationScope,
} from './series-scope-dialog'

export function EditExpenseForm({
  groupId,
  expenseId,
  runtimeFeatureFlags,
}: {
  groupId: string
  expenseId: string
  runtimeFeatureFlags: RuntimeFeatureFlags
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const { t: tExpenseForm } = useTranslation(undefined, {
    keyPrefix: 'ExpenseForm',
  })
  const { data: groupData } = trpc.groups.get.useQuery({ groupId })
  const group = groupData?.group
  const currentLedgerParticipantId =
    groupData?.currentLedgerParticipantId ?? null
  const isPendingInvitee = useIsPendingInvitee()
  const linkInviteToken = useLinkInviteToken()

  const { data: expenseData } = trpc.groups.expenses.get.useQuery({
    groupId,
    expenseId,
    linkInviteToken,
  })
  const expense = expenseData?.expense
  const seriesId = (
    expense as typeof expense & {
      recurringSeriesId?: string | null
    }
  )?.recurringSeriesId
  const [scopeDialog, setScopeDialog] = useState<{
    mode: 'update' | 'delete'
    expense?: Parameters<typeof updateExpenseMutateAsync>[0]['expense']
  } | null>(null)

  const navigate = useNavigate()

  const { mutateAsync: updateExpenseMutateAsync } = useUpdateExpenseMutation({
    linkInviteToken,
  })
  const { mutateAsync: deleteExpenseMutateAsync } = useDeleteExpenseMutation({
    linkInviteToken,
  })

  if (!group || !expense) return null

  // The expense form is read-only when the group is archived or when the
  // viewer is a PENDING invitee. The server enforces the same rule on
  // `groups.expenses.update` and `groups.expenses.delete`.
  const readOnly = !!group.archived || isPendingInvitee

  if (isPendingInvitee) {
    return (
      <Card className="mobile-surface">
        <CardHeader className="hidden sm:flex">
          <CardTitle>{t('pendingInviteeExpenseTitle')}</CardTitle>
          <CardDescription>{expense.title}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {t('pendingInviteeExpenseDescription')}
          </p>
          <div>
            <Button asChild variant="secondary">
              <Link href={`/groups/${groupId}/expenses`}>
                {t('backToExpenses')}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <ExpenseForm
        group={group}
        expense={expense}
        currentLedgerParticipantId={currentLedgerParticipantId}
        linkInviteToken={linkInviteToken}
        readOnly={readOnly}
        heading={tExpenseForm('Expense.editTitle', { title: expense.title })}
        onSubmit={async (expense) => {
          if (readOnly) return
          if (seriesId) {
            setScopeDialog({ mode: 'update', expense })
            return
          }
          await updateExpenseMutateAsync({ expenseId, groupId, expense })
          navigate({
            to: '/groups/$groupId/expenses/$expenseId',
            params: { groupId: group.id, expenseId },
            replace: true,
          })
        }}
        onDelete={async () => {
          if (readOnly) return
          if (seriesId) {
            setScopeDialog({ mode: 'delete' })
            return
          }
          await deleteExpenseMutateAsync({ expenseId, groupId })
        }}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />
      <SeriesScopeDialog
        open={scopeDialog != null}
        mode={scopeDialog?.mode ?? 'update'}
        onOpenChange={(open) => {
          if (!open) setScopeDialog(null)
        }}
        onConfirm={async (scope: SeriesMutationScope) => {
          const pending = scopeDialog
          setScopeDialog(null)
          if (!pending) return
          if (pending.mode === 'delete') {
            await deleteExpenseMutateAsync({
              expenseId,
              groupId,
              scope,
            } as Parameters<typeof deleteExpenseMutateAsync>[0])
            return
          }
          if (!pending.expense) return
          await updateExpenseMutateAsync({
            expenseId,
            groupId,
            expense: pending.expense,
            scope,
          } as Parameters<typeof updateExpenseMutateAsync>[0])
          await navigate({
            to: '/groups/$groupId/expenses/$expenseId',
            params: { groupId: group.id, expenseId },
            replace: true,
          })
        }}
      />
    </>
  )
}
