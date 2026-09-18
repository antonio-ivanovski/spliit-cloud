import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  expenseFormCancelLink,
  expenseListLink,
  getGlobalExpensesSearch,
  isGlobalExpensesReturnTo,
} from '@/lib/expense-navigation'
import type { RuntimeFeatureFlags } from '@/lib/featureFlags'
import { OfflineWriteError } from '@/lib/offline/write-guard'
import { useOnlineStatus } from '@/lib/use-online-status'
import { trpc } from '@/trpc/client'

import { useIsReadOnlyGroupViewer } from '../current-group-context'
import { useGroupAccessSearch } from '../use-group-access-search'
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
  const access = useGroupAccessSearch()
  const { data: groupData } = trpc.groups.get.useQuery({ groupId, ...access })
  const group = groupData?.group
  const currentLedgerParticipantId =
    groupData?.currentLedgerParticipantId ?? null
  const isReadOnlyGroupViewer = useIsReadOnlyGroupViewer()
  const expenseQuery = trpc.groups.expenses.get.useQuery({
    groupId,
    expenseId,
    ...access,
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
  // Cold offline navigation
  // (no group/expense data) shows an explicit connection-required state and
  // never initializes an editable form from a stale snapshot. When the form
  // was already loaded (dirty or not) and connectivity drops, keep it mounted
  // in-memory with the existing navigation/PWA-update blocker, disable
  // submission, and show "not saved" — no durable draft storage. Reconnect
  // refetches permission/version without replacing dirty inputs; the existing
  // version-conflict dialog stays authoritative.
  const isOnline = useOnlineStatus()

  const { mutateAsync: updateExpenseMutateAsync } = useUpdateExpenseMutation({
    onConflict: () => setConflictOpen(true),
  })
  const { mutateAsync: deleteExpenseMutateAsync } = useDeleteExpenseMutation({
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

  if (!isOnline && (!group || !expense)) {
    return (
      <Card>
        <CardHeader className="hidden sm:flex">
          <CardTitle>
            {tExpenseForm('Expense.editTitle', { title: '' })}
          </CardTitle>
          <CardDescription>{t('backToExpenses')}</CardDescription>
        </CardHeader>
        <CardContent spacing="standalone" className="flex flex-col gap-3">
          <output className="block text-sm text-muted-foreground">
            This feature needs a connection
          </output>
          <div>
            <Button
              variant="secondary"
              nativeButton={false}
              render={<Link {...expenseListLink(groupId, returnTo)} />}
            >
              {t('backToExpenses')}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!group || !expense) return null
  const expectedVersion = expense.version
  const offlineWithData = !isOnline

  // The expense form is read-only when the group is archived or when the
  // viewer is a PENDING invitee. The server enforces the same rule on
  // `groups.expenses.update` and `groups.expenses.delete`.
  const readOnly =
    !!group.archived || isReadOnlyGroupViewer || !expense.permissions.canEdit

  if (isReadOnlyGroupViewer) {
    return (
      <Card>
        <CardHeader className="hidden sm:flex">
          <CardTitle>{t('pendingInviteeExpenseTitle')}</CardTitle>
          <CardDescription>{expense.title}</CardDescription>
        </CardHeader>
        <CardContent spacing="standalone" className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {t('pendingInviteeExpenseDescription')}
          </p>
          <div>
            <Button
              variant="secondary"
              nativeButton={false}
              render={<Link {...expenseListLink(groupId, returnTo)} />}
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
      {offlineWithData && (
        <output className="mb-4 block rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          Reconnect to make changes — your edits are kept here but not saved.
        </output>
      )}
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
      {/* Offline with data: fieldset disables submission while keeping the
          form mounted (dirty preserved, PWA/nav blocker active). Cancel/back
          links stay usable; the guard rejects any missed submit. */}
      <fieldset disabled={offlineWithData} className="min-w-0">
        <ExpenseForm
          key={formRevision}
          group={group}
          expense={expense}
          cancelLink={expenseFormCancelLink(group.id, returnTo)}
          currentLedgerParticipantId={currentLedgerParticipantId}
          readOnly={readOnly}
          editScope={selectedScope}
          heading={tExpenseForm('Expense.editTitle', { title: expense.title })}
          onSubmit={async (expense) => {
            // Explicit offline entry check (fieldset is also disabled): never
            // send the update offline. The guard would also reject; throwing
            // here avoids optimism and keeps the draft mounted.
            if (!isOnline) throw new OfflineWriteError()
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
            if (readOnly || offlineWithData) return
            if (seriesId) {
              setScopeDialog({ mode: 'delete' })
              return
            }
            await deleteExpenseMutateAsync({ expenseId, groupId })
          }}
          runtimeFeatureFlags={runtimeFeatureFlags}
        />
      </fieldset>
      <SeriesScopeDialog
        key={scopeDialog?.mode ?? 'closed'}
        open={scopeDialog != null}
        mode={scopeDialog?.mode ?? 'update'}
        seriesStatus={seriesStatus}
        confirmationTarget={expense.title}
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
          const result = await expenseQuery.refetch()
          if (result.isError) return
          setConflictOpen(false)
          setFormRevision((revision) => revision + 1)
        }}
      />
    </>
  )
}
