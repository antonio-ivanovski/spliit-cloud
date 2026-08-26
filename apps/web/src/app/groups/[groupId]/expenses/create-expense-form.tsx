import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  expenseFormCancelLink,
  getGlobalExpensesSearch,
  isGlobalExpensesReturnTo,
} from '@/lib/expense-navigation'
import type { RuntimeFeatureFlags } from '@/lib/featureFlags'
import { useIdempotentCreate } from '@/lib/use-idempotent-create'
import { trpc } from '@/trpc/client'

import { useIsReadOnlyGroupViewer } from '../current-group-context'
import { useGroupAccessSearch } from '../use-group-access-search'
import { ExpenseForm } from './expense-form/index'
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
  const access = useGroupAccessSearch()
  const { data: groupData } = trpc.groups.get.useQuery({
    groupId,
    ...access,
  })
  const group = groupData?.group
  const currentLedgerParticipantId =
    groupData?.currentLedgerParticipantId ?? null
  const isReadOnlyGroupViewer = useIsReadOnlyGroupViewer()
  const { mutateAsync: createExpenseMutateAsync } = useCreateExpenseMutation()
  const navigate = useNavigate()
  const createAttempt = useIdempotentCreate()
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
        ...access,
      },
      { enabled: !!sourceExpenseId },
    )
  const sourceExpense = sourceExpenseData?.expense

  if (!group) return null

  if (isReadOnlyGroupViewer) {
    return (
      <Card>
        <CardHeader className="hidden sm:flex">
          <CardTitle>{tGroups('pendingInviteeExpenseTitle')}</CardTitle>
          <CardDescription>{t('create')}</CardDescription>
        </CardHeader>
        <CardContent spacing="standalone" className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {tGroups('pendingInviteeExpenseDescription')}
          </p>
          <div>
            <Button
              variant="secondary"
              nativeButton={false}
              render={
                <Link to="/groups/$groupId/expenses" params={{ groupId }} />
              }
            >
              {tGroups('backToExpenses')}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (group.archived) {
    return (
      <Card>
        <CardHeader className="hidden sm:flex">
          <CardTitle>{tGroups('bannerArchived')}</CardTitle>
          <CardDescription>{t('create')}</CardDescription>
        </CardHeader>
        <CardContent spacing="standalone" className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {tGroups('archivedReadOnly')}
          </p>
          <div>
            <Button
              variant="secondary"
              nativeButton={false}
              render={
                <Link to="/groups/$groupId/expenses" params={{ groupId }} />
              }
            >
              {tGroups('backToExpenses')}
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
        <CardHeader className="hidden sm:flex">
          <CardTitle>{t('create')}</CardTitle>
        </CardHeader>
        <CardContent spacing="standalone" className="flex flex-col gap-3">
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
      cancelLink={expenseFormCancelLink(group.id, searchParams.returnTo)}
      currentLedgerParticipantId={currentLedgerParticipantId}
      heading={
        sourceExpense
          ? tExpenseForm('Expense.createCopy', { title: sourceExpense.title })
          : undefined
      }
      onSubmit={async (expense) => {
        // Persistence only — navigation happens in `onSaved` so a
        // navigation failure is never conflated with a save failure.
        const result = await createAttempt.run((requestId) =>
          createExpenseMutateAsync({ groupId, requestId, expense }),
        )
        if (!result) return 'deferred'
        return 'saved'
      }}
      onSaved={async () => {
        if (isGlobalExpensesReturnTo(searchParams.returnTo)) {
          await navigate({
            to: '/expenses',
            search: getGlobalExpensesSearch(searchParams.returnTo) as never,
            replace: true,
          })
        } else {
          await navigate({
            to: '/groups/$groupId/expenses',
            params: { groupId: group.id },
            replace: true,
          })
        }
      }}
      runtimeFeatureFlags={runtimeFeatureFlags}
    />
  )
}
