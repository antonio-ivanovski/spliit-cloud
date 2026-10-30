import { Archive, Pencil, PiggyBank, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { useDocumentTitle } from '@/components/document-title'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { useToast } from '@/components/ui/use-toast'

import {
  useArchivePersonalBudget,
  useCreatePersonalBudget,
  useDeletePersonalBudget,
  usePersonalBudgets,
  usePersonalProfile,
  useUpdatePersonalBudget,
  type PersonalBudgetInput,
} from './api'
import { PersonalBudgetForm, type PersonalBudgetFormValue } from './budget-form'
import { PersonalBudgetProgress } from './budget-progress'
import { usePersonalTranslation } from './personal-i18n'
import type { PersonalBudget } from './types'

/**
 * Presentational budget list: progress + projection per budget, create/edit in
 * a responsive dialog, archive and two-tap delete. Tests render this view with
 * fixtures.
 */
export function PersonalBudgetsView({
  budgets,
  overallBudget,
  currencyCode,
  onCreate,
  onEdit,
  onArchive,
  onDelete,
  archivingId,
  deletingId,
}: {
  budgets: PersonalBudget[]
  overallBudget: PersonalBudget | null
  currencyCode: string
  onCreate: () => void
  onEdit: (budget: PersonalBudget) => void
  onArchive: (budget: PersonalBudget) => void
  onDelete: (budget: PersonalBudget) => void
  archivingId: string | null
  deletingId: string | null
}) {
  const { t } = usePersonalTranslation()
  void currencyCode

  if (budgets.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent
          spacing="standalone"
          className="flex min-h-64 flex-col items-center justify-center gap-3 text-center"
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <PiggyBank className="size-6" aria-hidden="true" />
          </span>
          <h2 className="font-semibold">{t('budgets.emptyTitle')}</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            {t('budgets.emptyDescription')}
          </p>
          <Button type="button" className="mt-1" onClick={onCreate}>
            <Plus className="me-1.5 size-4" aria-hidden="true" />
            {t('budgets.create')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={onCreate}>
          <Plus className="me-1.5 size-4" aria-hidden="true" />
          {t('budgets.create')}
        </Button>
      </div>
      {overallBudget && (
        <Card className="border-primary/20 bg-linear-to-br from-primary/8 via-card to-card">
          <CardHeader className="space-y-0 pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {t('overview.overallBudget')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <PersonalBudgetProgress budget={overallBudget} />
          </CardContent>
        </Card>
      )}
      {budgets.map((budget) => (
        <Card key={budget.id}>
          <CardContent spacing="standalone" className="space-y-3">
            <PersonalBudgetProgress budget={budget} />
            <div className="flex items-center justify-end gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() => onEdit(budget)}
              >
                <Pencil className="me-1.5 size-3.5" aria-hidden="true" />
                {t('budgets.edit')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                disabled={archivingId === budget.id}
                onClick={() => onArchive(budget)}
              >
                <Archive className="me-1.5 size-3.5" aria-hidden="true" />
                {archivingId === budget.id
                  ? t('budgets.archiving')
                  : t('budgets.archive')}
              </Button>
              <BudgetDeleteButton
                budget={budget}
                pending={deletingId === budget.id}
                onDelete={onDelete}
              />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function BudgetDeleteButton({
  budget,
  pending,
  onDelete,
}: {
  budget: PersonalBudget
  pending: boolean
  onDelete: (budget: PersonalBudget) => void
}) {
  const { t } = usePersonalTranslation()
  const [confirming, setConfirming] = useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 px-2 text-xs text-destructive hover:text-destructive"
      disabled={pending}
      onClick={() => {
        if (confirming) onDelete(budget)
        else {
          setConfirming(true)
          setTimeout(() => setConfirming(false), 4000)
        }
      }}
    >
      <Trash2 className="me-1.5 size-3.5" aria-hidden="true" />
      {confirming ? t('budgets.confirmDelete') : t('budgets.delete')}
    </Button>
  )
}

export function PersonalBudgetsPage() {
  const { t } = usePersonalTranslation()
  useDocumentTitle(t('budgets.documentTitle'))
  const { toast } = useToast()
  const profileQuery = usePersonalProfile()
  const budgetsQuery = usePersonalBudgets()
  const createMutation = useCreatePersonalBudget()
  const updateMutation = useUpdatePersonalBudget()
  const archiveMutation = useArchivePersonalBudget()
  const deleteMutation = useDeletePersonalBudget()

  const [dialog, setDialog] = useState<
    | { mode: 'closed' }
    | { mode: 'create' }
    | { mode: 'edit'; budget: PersonalBudget }
  >({ mode: 'closed' })

  const currencyCode = profileQuery.data?.currencyCode ?? 'USD'
  const budgets = budgetsQuery.data?.budgets ?? []
  const overallBudget = budgetsQuery.data?.overallBudget ?? null
  const saving = createMutation.isPending || updateMutation.isPending

  async function handleSubmit(value: PersonalBudgetFormValue) {
    const input: PersonalBudgetInput = {
      name: value.name,
      amount: value.amount,
      period: 'MONTHLY',
      categoryScope: value.categoryScope,
      categoryIds: value.categoryIds,
      startDay: 1,
    }
    try {
      if (dialog.mode === 'edit') {
        await updateMutation.mutateAsync({ id: dialog.budget.id, ...input })
      } else {
        await createMutation.mutateAsync(input)
      }
      toast({ description: t('budgets.saved') })
      setDialog({ mode: 'closed' })
    } catch (error) {
      toast({
        description:
          error instanceof Error ? error.message : t('budgets.saveFailed'),
        variant: 'destructive',
      })
    }
  }

  if (profileQuery.isPending || budgetsQuery.isPending) {
    return (
      <div
        className="flex flex-col gap-4"
        aria-busy="true"
        aria-label={t('loading')}
      >
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      </div>
    )
  }

  if (profileQuery.isError || budgetsQuery.isError) {
    const error = profileQuery.error ?? budgetsQuery.error
    return (
      <Card className="border-destructive/30">
        <CardContent
          spacing="standalone"
          className="flex min-h-56 flex-col items-center justify-center gap-3 text-center"
        >
          <p role="alert" className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : t('budgets.error')}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void profileQuery.refetch()
              void budgetsQuery.refetch()
            }}
          >
            {t('retry')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <PersonalBudgetsView
        budgets={budgets}
        overallBudget={overallBudget}
        currencyCode={currencyCode}
        onCreate={() => setDialog({ mode: 'create' })}
        onEdit={(budget) => setDialog({ mode: 'edit', budget })}
        onArchive={(budget) => {
          void archiveMutation
            .mutateAsync({ id: budget.id, archived: true })
            .then(() => toast({ description: t('budgets.archived') }))
            .catch((error: unknown) =>
              toast({
                description:
                  error instanceof Error
                    ? error.message
                    : t('budgets.saveFailed'),
                variant: 'destructive',
              }),
            )
        }}
        onDelete={(budget) => {
          void deleteMutation
            .mutateAsync({ id: budget.id })
            .then(() => toast({ description: t('budgets.deleted') }))
            .catch((error: unknown) =>
              toast({
                description:
                  error instanceof Error
                    ? error.message
                    : t('budgets.saveFailed'),
                variant: 'destructive',
              }),
            )
        }}
        archivingId={
          archiveMutation.isPending
            ? (archiveMutation.variables?.id ?? null)
            : null
        }
        deletingId={
          deleteMutation.isPending
            ? (deleteMutation.variables?.id ?? null)
            : null
        }
      />

      <ResponsiveDialog
        open={dialog.mode !== 'closed'}
        onOpenChange={(open) => {
          if (!open) setDialog({ mode: 'closed' })
        }}
      >
        <ResponsiveDialogContent className="sm:max-w-lg">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {dialog.mode === 'edit' ? t('budgets.edit') : t('budgets.create')}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody>
            {dialog.mode !== 'closed' && (
              <PersonalBudgetForm
                key={dialog.mode === 'edit' ? dialog.budget.id : 'create'}
                currencyCode={currencyCode}
                initial={dialog.mode === 'edit' ? dialog.budget : null}
                existingBudgets={budgets}
                pending={saving}
                onSubmit={(value) => void handleSubmit(value)}
              />
            )}
          </ResponsiveDialogBody>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  )
}
