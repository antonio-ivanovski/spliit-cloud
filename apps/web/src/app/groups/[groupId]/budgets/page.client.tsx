import { useNavigate } from '@tanstack/react-router'
import { Plus, RefreshCw, WalletCards } from 'lucide-react'

import {
  BudgetCard,
  BudgetCardSkeleton,
} from '@/app/groups/[groupId]/budgets/budget-card'
import {
  normalizeBudget,
  type BudgetSummary,
} from '@/app/groups/[groupId]/budgets/budget-types'
import {
  useCurrentGroup,
  useIsPendingInvitee,
} from '@/app/groups/[groupId]/current-group-context'
import { CollapsibleSection } from '@/app/groups/collapsible-section'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { trpc } from '@/trpc/client'

import { useBudgetTranslation } from './budget-i18n'

function CreateBudgetCard({ onClick }: { onClick: () => void }) {
  const t = useBudgetTranslation()

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('createCard.title')}
      className="motion-surface motion-surface-interactive relative min-h-[5.5rem] w-full overflow-hidden rounded-lg border border-primary/25 bg-linear-to-br from-primary/8 via-background to-background text-left text-base shadow-[0_1px_0_0_hsl(var(--primary)/0.08)] outline-hidden transition-colors hover:border-primary/35 hover:bg-primary/5 focus-visible:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-12 -right-10 h-28 w-28 rounded-full bg-primary/10 blur-2xl"
      />
      <div className="relative flex min-h-[5.5rem] min-w-0 items-center gap-3 px-3 py-3 text-foreground">
        <span
          aria-hidden
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary ring-1 ring-primary/15"
        >
          <Plus className="h-4 w-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{t('createCard.title')}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">
            {t('createCard.description')}
          </span>
        </span>
      </div>
    </button>
  )
}

export default function GroupBudgetsPageClient() {
  const t = useBudgetTranslation()
  const { groupId, group, currentMember } = useCurrentGroup()
  const isPendingInvitee = useIsPendingInvitee()
  const navigate = useNavigate()
  const canEdit =
    !!currentMember &&
    currentMember.role === 'ADMIN' &&
    !group?.archived &&
    !isPendingInvitee
  const budgetsQuery = trpc.groups.budgets.list.useQuery({
    groupId,
    includeArchived: true,
  })

  const goToCreate = () =>
    navigate({
      to: '/groups/$groupId/budgets/create',
      params: { groupId },
    })

  if (budgetsQuery.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <BudgetCardSkeleton />
        <BudgetCardSkeleton />
      </div>
    )
  }

  if (!group) return null
  if (budgetsQuery.isError) {
    return (
      <Card className="mobile-surface">
        <CardContent className="flex flex-col items-start gap-3 py-8">
          <p role="alert" className="text-sm text-destructive">
            {budgetsQuery.error.message}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void budgetsQuery.refetch()}
          >
            <RefreshCw className="mr-2 size-4" aria-hidden="true" />
            {t('retry')}
          </Button>
        </CardContent>
      </Card>
    )
  }
  const budgets = (budgetsQuery.data?.budgets ?? []).map((budget) =>
    normalizeBudget(budget as unknown as Record<string, unknown>),
  ) as BudgetSummary[]
  const active = budgets.filter((budget) => !budget.archived)
  const archived = budgets.filter((budget) => budget.archived)
  const completed = active.filter(
    (budget) => budget.period.lifecycle === 'COMPLETED',
  )
  const current = active.filter(
    (budget) => budget.period.lifecycle !== 'COMPLETED',
  )

  return (
    <div className="flex flex-col gap-4">
      {active.length === 0 ? (
        <Card className="mobile-surface">
          <CardContent className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <WalletCards className="size-6" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-medium">{t('empty.title')}</h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                {t('empty.description')}
              </p>
            </div>
            {canEdit && (
              <Button variant="outline" onClick={goToCreate}>
                {t('create')}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {canEdit && <CreateBudgetCard onClick={goToCreate} />}
          {current.length > 0 && (
            <div className="mobile-divide-y flex flex-col gap-0 sm:gap-4">
              {current.map((budget) => (
                <BudgetCard
                  key={budget.id}
                  budget={budget}
                  groupId={groupId}
                  group={group}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {completed.length > 0 && (
        <CollapsibleSection
          title={t('completedBudgets')}
          defaultOpen={false}
          storageKey={`group-budgets-completed-${groupId}`}
        >
          <div className="mobile-divide-y flex flex-col gap-0 opacity-80 sm:gap-4">
            {completed.map((budget) => (
              <BudgetCard
                key={budget.id}
                budget={budget}
                groupId={groupId}
                group={group}
                compact
              />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {archived.length > 0 && (
        <CollapsibleSection
          title={t('archived')}
          defaultOpen={false}
          storageKey={`group-budgets-archived-${groupId}`}
        >
          <div className="mobile-divide-y flex flex-col gap-0 opacity-75 sm:gap-4">
            {archived.map((budget) => (
              <BudgetCard
                key={budget.id}
                budget={budget}
                groupId={groupId}
                group={group}
                compact
              />
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  )
}
