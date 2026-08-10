import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  getGlobalExpensesSearch,
  isGlobalExpensesReturnTo,
} from '@/lib/expense-navigation'
import type { RuntimeFeatureFlags } from '@/lib/featureFlags'
import { trpc } from '@/trpc/client'

import { useIsPendingInvitee } from '../current-group-context'
import { useLinkInviteToken } from '../use-link-invite-token'
import { ExpenseForm, type ExpenseSubmitOutcome } from './expense-form/index'
import {
  useDeleteExpenseMutation,
  useUpdateExpenseMutation,
} from './expense-mutation-hooks'
import { ExpenseVersionConflictDialog } from './expense-version-conflict-dialog'
import {
  SeriesScopeDialog,
  type SeriesMutationScope,
} from './series-scope-dialog'

export function EditExpenseForm({
  groupId,
  expenseId,
  runtimeFeatureFlags,
  initialScope,
  returnTo,
}: {
  groupId: string
  expenseId: string
  runtimeFeatureFlags: RuntimeFeatureFlags
  initialScope?: SeriesMutationScope
  returnTo?: string
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

  const expenseQuery = trpc.groups.expenses.get.useQuery({
    groupId,
    expenseId,
    linkInviteToken,
  })
  const expenseData = expenseQuery.data
  const expense = expenseData?.expense
  const [conflictOpen, setConflictOpen] = useState(false)
  const [formRevision, setFormRevision] = useState(0)
  const seriesId = (
    expense as typeof expense & {
      recurringSeriesId?: string | null
    }
  )?.recurringSeriesId
  const seriesStatus =
    expense?.recurringSeries?.status ??
    (
      expense as typeof expense & {
        recurringSeriesStatus?:
          | 'ACTIVE'
          | 'PAUSED'
          | 'COMPLETED'
          | 'CANCELLED'
          | null
      }
    )?.recurringSeriesStatus ??
    undefined
  const [scopeDialog, setScopeDialog] = useState<{
    mode: 'update' | 'delete'
    expense?: Parameters<typeof updateExpenseMutateAsync>[0]['expense']
    resolve?: (outcome: ExpenseSubmitOutcome) => void
    reject?: (error: unknown) => void
  } | null>(null)

  const navigate = useNavigate()

  const { mutateAsync: updateExpenseMutateAsync } = useUpdateExpenseMutation({
    linkInviteToken,
    onConflict: () => setConflictOpen(true),
  })
  const { mutateAsync: deleteExpenseMutateAsync } = useDeleteExpenseMutation({
    linkInviteToken,
    onDeleted: isGlobalExpensesReturnTo(returnTo)
      ? () =>
          navigate({
            to: '/expenses',
            search: getGlobalExpensesSearch(returnTo) as never,
            replace: true,
          })
      : undefined,
  })
  const selectedScope = initialScope ?? null

  const navigateAfterUpdate = async () => {
    if (isGlobalExpensesReturnTo(returnTo)) {
      await navigate({
        to: '/expenses',
        search: getGlobalExpensesSearch(returnTo) as never,
        replace: true,
      })
      return
    }
    await navigate({
      to: '/groups/$groupId/expenses/$expenseId',
      params: { groupId: groupId, expenseId },
      search: returnTo ? { returnTo } : undefined,
      replace: true,
    })
  }

  if (!group || !expense) return null
  const expectedVersion = expense.version

  // The expense form is read-only when the group is archived or when the
  // viewer is a PENDING invitee. The server enforces the same rule on
  // `groups.expenses.update` and `groups.expenses.delete`.
  const readOnly =
    !!group.archived || isPendingInvitee || !expense.permissions.canEdit

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
            <Button
              variant="secondary"
              render={<Link href={returnTo ?? `/groups/${groupId}/expenses`} />}
            >
              {t('backToExpenses')}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      {seriesId && selectedScope && (
        <div
          className="mb-4 rounded-md border bg-muted/50 px-4 py-2.5 text-sm text-muted-foreground"
          aria-live="polite"
        >
          {tExpenseForm(
            selectedScope === 'OCCURRENCE'
              ? 'Expense.recurringEditScopeOccurrence'
              : 'Expense.recurringEditScopeFuture',
          )}
        </div>
      )}
      <ExpenseForm
        key={formRevision}
        group={group}
        expense={expense}
        cancelHref={returnTo ?? `/groups/${group.id}`}
        currentLedgerParticipantId={currentLedgerParticipantId}
        linkInviteToken={linkInviteToken}
        readOnly={readOnly}
        editScope={selectedScope}
        heading={tExpenseForm('Expense.editTitle', { title: expense.title })}
        onSubmit={async (expense) => {
          if (seriesId) {
            if (selectedScope) {
              await updateExpenseMutateAsync({
                expenseId,
                groupId,
                expense,
                scope: selectedScope,
                expectedVersion,
              } as Parameters<typeof updateExpenseMutateAsync>[0])
              return 'saved'
            }
            // The scope dialog performs the actual update later
            // (deferred save — the pending submit stays open until the
            // dialog either cancels or finishes persistence).
            return new Promise<ExpenseSubmitOutcome>((resolve, reject) => {
              setScopeDialog({
                mode: 'update',
                expense,
                resolve,
                reject,
              })
            })
          }
          await updateExpenseMutateAsync({
            expenseId,
            groupId,
            expense,
            expectedVersion,
          })
          return 'saved'
        }}
        // Post-save navigation is separate from persistence so a
        // navigation failure can never be reported as a save failure.
        onSaved={navigateAfterUpdate}
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
        key={scopeDialog?.mode ?? 'closed'}
        open={scopeDialog != null}
        mode={scopeDialog?.mode ?? 'update'}
        seriesStatus={seriesStatus}
        onOpenChange={(open) => {
          if (!open) {
            const pending = scopeDialog
            setScopeDialog(null)
            // Cancelling a deferred submit settles it without persistence or
            // navigation, so RHF can leave its submitting state.
            if (pending?.mode === 'update') pending.resolve?.('deferred')
          }
        }}
        onConfirm={async (scope: SeriesMutationScope, stopRecurrence) => {
          const pending = scopeDialog
          setScopeDialog(null)
          if (!pending) return
          if (pending.mode === 'delete') {
            await deleteExpenseMutateAsync({
              expenseId,
              groupId,
              scope,
              ...(scope === 'THIS_AND_FUTURE' && stopRecurrence !== undefined
                ? { stopRecurrence }
                : {}),
            } as Parameters<typeof deleteExpenseMutateAsync>[0])
            return
          }
          if (!pending.expense) return
          try {
            await updateExpenseMutateAsync({
              expenseId,
              groupId,
              expense: pending.expense,
              scope,
              expectedVersion,
            } as Parameters<typeof updateExpenseMutateAsync>[0])
            // Let ExpenseForm mark persistence terminal and run onSaved. A
            // navigation rejection then gets the same safe retry banner as a
            // direct edit, without re-running this mutation.
            pending.resolve?.('saved')
          } catch (error) {
            pending.reject?.(error)
          }
        }}
      />
      <ExpenseVersionConflictDialog
        open={conflictOpen}
        onKeepDraft={() => setConflictOpen(false)}
        onReload={async () => {
          await expenseQuery.refetch()
          setConflictOpen(false)
          setFormRevision((revision) => revision + 1)
        }}
      />
    </>
  )
}
