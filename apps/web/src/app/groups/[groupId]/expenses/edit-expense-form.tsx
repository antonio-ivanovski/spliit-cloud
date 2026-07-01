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
import { useRouter } from '@/lib/navigation'
import { trpc } from '@/trpc/client'
import { useTranslation } from 'react-i18next'
import { useIsPendingInvitee } from '../current-group-context'
import { useLinkInviteToken } from '../use-link-invite-token'
import { ExpenseForm } from './expense-form'
import {
  useDeleteExpenseMutation,
  useUpdateExpenseMutation,
} from './expense-mutation-hooks'

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

  const router = useRouter()

  const { mutateAsync: updateExpenseMutateAsync } = useUpdateExpenseMutation({
    linkInviteToken,
  })
  const { mutateAsync: deleteExpenseMutateAsync } = useDeleteExpenseMutation({
    linkInviteToken,
  })

  if (!group || !expense) return null

  // The expense form is read-only when the group is archived or when the
  // viewer is a PENDING invitee. The server enforces the same rule on
  // `groups.expenses.update` and `groups.expenses.delete`; hiding the
  // form controls keeps the UI consistent with the backend.
  const readOnly = !!group.archived || isPendingInvitee

  if (isPendingInvitee) {
    return (
      <Card>
        <CardHeader>
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
    <ExpenseForm
      group={group}
      expense={expense}
      currentLedgerParticipantId={currentLedgerParticipantId}
      readOnly={readOnly}
      onSubmit={async (expense) => {
        if (readOnly) return
        await updateExpenseMutateAsync({
          expenseId,
          groupId,
          expense,
        })
        router.replace({
          to: '/groups/$groupId/expenses',
          params: { groupId: group.id },
        })
      }}
      onDelete={async () => {
        if (readOnly) return
        await deleteExpenseMutateAsync({ expenseId, groupId })
      }}
      runtimeFeatureFlags={runtimeFeatureFlags}
    />
  )
}
