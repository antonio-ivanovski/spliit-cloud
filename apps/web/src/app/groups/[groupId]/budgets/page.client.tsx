import { Link } from '@tanstack/react-router'
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
  useIsReadOnlyGroupViewer,
} from '@/app/groups/[groupId]/current-group-context'
import { useGroupAccessSearch } from '@/app/groups/[groupId]/use-group-access-search'
import { CollapsibleSection } from '@/app/groups/collapsible-section'
import { OfflineEmptyState } from '@/components/offline-empty-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useOfflineWithoutData } from '@/lib/use-online-status'
import { trpc } from '@/trpc/client'

import { useBudgetTranslation } from './budget-i18n'

function CreateBudgetCard({ groupId }: { groupId: string }) {
  const t = useBudgetTranslation()

  return (
    <Link
      to="/groups/$groupId/budgets/create"
      params={{ groupId }}
      aria-label={t('createCard.title')}
      className="motion-surface motion-surface-interactive relative min-h-[5.5rem] w-full overflow-hidden rounded-lg border border-primary/25 bg-linear-to-br from-primary/8 via-background to-background text-start text-base text-foreground no-underline shadow-[0_1px_0_0_hsl(var(--primary)/0.08)] outline-hidden transition-colors hover:border-primary/35 hover:bg-primary/5 focus-visible:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -end-10 -top-12 h-28 w-28 rounded-full bg-primary/10 blur-2xl"
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
    </Link>
  )
}

export function BudgetEmptyState({
  groupId,
  canCreate,
}: {
  groupId: string
  canCreate: boolean
}) {
  const t = useBudgetTranslation()

  return (
    <Card>
      <CardContent spacing="standalone" className="py-10 sm:py-12">
        <div
          data-testid="budget-empty-state"
          className="mx-auto flex max-w-md flex-col items-center gap-3 text-center"
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <WalletCards className="size-6" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-medium">{t('empty.title')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('empty.description')}
            </p>
          </div>
          {canCreate && (
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <Link
                  to="/groups/$groupId/budgets/create"
                  params={{ groupId }}
                />
              }
            >
              {t('create')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default function GroupBudgetsPageClient() {
  const t = useBudgetTranslation()
  const { groupId, group, currentMember } = useCurrentGroup()
  const isReadOnlyGroupViewer = useIsReadOnlyGroupViewer()
  const { linkInviteToken, viewKey } = useGroupAccessSearch()
  const canCreate =
    !!currentMember && !group?.archived && !isReadOnlyGroupViewer
  const budgetsQuery = trpc.groups.budgets.list.useQuery({
    groupId,
    includeArchived: true,
    linkInviteToken,
    viewKey,
  })
  const showOfflineEmpty = useOfflineWithoutData(!!budgetsQuery.data)

  if (showOfflineEmpty) {
    return <OfflineEmptyState onRetry={() => void budgetsQuery.refetch()} />
  }

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
      <Card>
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
            <RefreshCw className="me-2 size-4" aria-hidden="true" />
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
        <BudgetEmptyState groupId={groupId} canCreate={canCreate} />
      ) : (
        <div className="flex flex-col gap-4">
          {canCreate && <CreateBudgetCard groupId={groupId} />}
          {current.length > 0 && (
            <div className="flex flex-col gap-3 sm:gap-4">
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
          <div className="flex flex-col gap-3 opacity-80 sm:gap-4">
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
          <div className="flex flex-col gap-3 opacity-75 sm:gap-4">
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
