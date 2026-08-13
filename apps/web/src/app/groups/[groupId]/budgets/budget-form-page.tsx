import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'

import { BudgetForm } from '@/app/groups/[groupId]/budgets/budget-form'
import { normalizeBudgetDetail } from '@/app/groups/[groupId]/budgets/budget-types'
import {
  useCurrentGroup,
  useIsPendingInvitee,
} from '@/app/groups/[groupId]/current-group-context'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { useIdempotentCreate } from '@/lib/use-idempotent-create'
import { trpc } from '@/trpc/client'

import { useBudgetTranslation } from './budget-i18n'

type Props = {
  groupId: string
  /** When provided the page edits this budget; otherwise it creates one. */
  budgetId?: string
}

export function BudgetFormPage({ groupId, budgetId }: Props) {
  const t = useBudgetTranslation()
  const { group, currentMember } = useCurrentGroup()
  const isPendingInvitee = useIsPendingInvitee()
  const navigate = useNavigate()
  const { toast } = useToast()
  const utils = trpc.useUtils()

  const isEdit = budgetId != null
  const budgetQuery = trpc.groups.budgets.get.useQuery(
    { groupId, budgetId: budgetId ?? '' },
    { enabled: isEdit },
  )
  const budget =
    isEdit && budgetQuery.data?.budget
      ? normalizeBudgetDetail(
          budgetQuery.data.budget as unknown as Record<string, unknown>,
        )
      : null

  const createMutation = trpc.groups.budgets.create.useMutation({
    onSuccess: async () => {
      await utils.groups.budgets.list.invalidate({ groupId })
      toast({ description: t('created'), variant: 'success' })
    },
    onError: (error) =>
      toast({ description: error.message, variant: 'destructive' }),
  })
  const createAttempt = useIdempotentCreate()
  const updateMutation = trpc.groups.budgets.update.useMutation({
    onSuccess: async () => {
      await utils.groups.budgets.get.invalidate({ groupId, budgetId })
      await utils.groups.budgets.list.invalidate({ groupId })
      toast({ description: t('updated'), variant: 'success' })
    },
    onError: (error) =>
      toast({ description: error.message, variant: 'destructive' }),
  })

  const canEdit =
    !!currentMember &&
    !group?.archived &&
    !isPendingInvitee &&
    (isEdit ? Boolean(budget?.permissions.canEdit) : true)

  if (!group) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  if (!canEdit) {
    return (
      <Card className="mobile-surface">
        <CardHeader className="hidden sm:flex">
          <CardTitle>{isEdit ? t('edit') : t('create')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {t('form.notAllowed')}
          </p>
          <div>
            <Button
              variant="secondary"
              render={
                <Link to="/groups/$groupId/budgets" params={{ groupId }} />
              }
            >
              {t('backToBudgets')}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (isEdit && budgetQuery.isError) {
    return (
      <Card className="mobile-surface">
        <CardContent className="flex flex-col gap-3">
          <p role="alert" className="text-sm text-destructive">
            {budgetQuery.error.message}
          </p>
          <div>
            <Button
              variant="secondary"
              render={
                <Link to="/groups/$groupId/budgets" params={{ groupId }} />
              }
            >
              {t('backToBudgets')}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (isEdit && (budgetQuery.isLoading || !budget)) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  const goBack = () =>
    navigate({
      to: '/groups/$groupId/budgets',
      params: { groupId },
      replace: true,
    })

  return (
    <Card className="mobile-surface">
      <CardHeader className="hidden sm:flex">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="-ms-2 hidden shrink-0 sm:inline-flex"
            render={
              <Link
                to="/groups/$groupId/budgets"
                params={{ groupId }}
                title={t('backToBudgets')}
              />
            }
          >
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
          </Button>
          <CardTitle className="hidden min-w-0 flex-1 truncate sm:block">
            {isEdit ? t('edit') : t('create')}
          </CardTitle>
        </div>
        <CardDescription>{t('form.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <BudgetForm
          groupId={groupId}
          group={group}
          budget={budget ?? undefined}
          pending={isEdit ? updateMutation.isPending : createMutation.isPending}
          onSubmit={async (input) => {
            if (isEdit && budgetId) {
              await updateMutation.mutateAsync({
                groupId,
                budgetId,
                ...input,
              })
              await navigate({
                to: '/groups/$groupId/budgets/$budgetId',
                params: { groupId, budgetId },
                replace: true,
              })
            } else {
              const created = await createAttempt.run((requestId) =>
                createMutation.mutateAsync({ groupId, requestId, ...input }),
              )
              if (created === null) return
              await goBack()
            }
          }}
        />
      </CardContent>
    </Card>
  )
}
