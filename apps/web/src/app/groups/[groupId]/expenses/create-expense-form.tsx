import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { RuntimeFeatureFlags } from '@/lib/featureFlags'
import { trpc } from '@/trpc/client'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useIsPendingInvitee } from '../current-group-context'
import { useLinkInviteToken } from '../use-link-invite-token'
import { ExpenseForm } from './expense-form'
import { useCreateExpenseMutation } from './expense-mutation-hooks'

const createExpenseRouteApi = getRouteApi('/groups/$groupId/expenses/create')

export function CreateExpenseForm({
  groupId,
  runtimeFeatureFlags,
}: {
  groupId: string
  expenseId?: string
  runtimeFeatureFlags: RuntimeFeatureFlags
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Expenses' })
  const { t: tGroups } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const { t: tExpenseForm } = useTranslation(undefined, {
    keyPrefix: 'ExpenseForm',
  })
  const { data: groupData } = trpc.groups.get.useQuery({ groupId })
  const group = groupData?.group
  const currentLedgerParticipantId =
    groupData?.currentLedgerParticipantId ?? null
  const isPendingInvitee = useIsPendingInvitee()
  const linkInviteToken = useLinkInviteToken()

  const { mutateAsync: createExpenseMutateAsync } = useCreateExpenseMutation({
    linkInviteToken,
  })
  const navigate = useNavigate()
  // `ExpenseForm` is shared with the edit route, where calling
  // `useSearch` against the create route would throw.
  const searchParams = createExpenseRouteApi.useSearch()
  // `?fromExpenseId=<id>` arrives from the "Make a copy" button on
  // the edit page; we prefill the form and force today's date.
  const sourceExpenseId = searchParams.fromExpenseId ?? ''
  const { data: sourceExpenseData, isFetching: isFetchingSource } =
    trpc.groups.expenses.get.useQuery(
      {
        groupId,
        expenseId: sourceExpenseId,
        linkInviteToken,
      },
      { enabled: !!sourceExpenseId },
    )
  const sourceExpense = sourceExpenseData?.expense

  if (!group) return null

  if (isPendingInvitee) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{tGroups('pendingInviteeExpenseTitle')}</CardTitle>
          <CardDescription>{t('create')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {tGroups('pendingInviteeExpenseDescription')}
          </p>
          <div>
            <Button asChild variant="secondary">
              <Link href={`/groups/${groupId}/expenses`}>
                {tGroups('backToExpenses')}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (group.archived) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{tGroups('bannerArchived')}</CardTitle>
          <CardDescription>{t('create')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {tGroups('archivedReadOnly')}
          </p>
          <div>
            <Button asChild variant="secondary">
              <Link href={`/groups/${groupId}/expenses`}>
                {tGroups('backToExpenses')}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Hold the form render until the source expense resolves; `useForm`
  // locks in `defaultValues` on first render.
  if (sourceExpenseId && (isFetchingSource || !sourceExpense)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('create')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    )
  }

  return (
    <ExpenseForm
      group={group}
      {...(sourceExpense ? { expense: sourceExpense, isCopy: true } : {})}
      searchParams={searchParams}
      currentLedgerParticipantId={currentLedgerParticipantId}
      heading={
        sourceExpense
          ? tExpenseForm('Expense.createCopy', { title: sourceExpense.title })
          : undefined
      }
      onSubmit={async (expense) => {
        await createExpenseMutateAsync({
          groupId,
          expense,
        })
        navigate({
          to: '/groups/$groupId/expenses',
          params: { groupId: group.id },
          replace: true,
        })
      }}
      runtimeFeatureFlags={runtimeFeatureFlags}
    />
  )
}
