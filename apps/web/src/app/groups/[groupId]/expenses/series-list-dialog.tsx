import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale } from '@/i18n/react'
import { formatExpenseClosed } from '@/lib/expense-display'
import { formatCurrency, getCurrencyFromGroup } from '@/lib/utils'
import { trpc } from '@/trpc/client'

import { useLinkInviteToken } from '../use-link-invite-token'
import { RecurringBadge } from './series-controls'

export function SeriesListDialog({
  groupId,
  seriesId,
  open,
  onOpenChange,
}: {
  groupId: string
  seriesId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseSeries' })
  const { t: tForm } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const locale = useLocale()
  const linkInviteToken = useLinkInviteToken()
  const [occurrenceCursor, setOccurrenceCursor] = useState<number | undefined>()
  const [loadedExpenses, setLoadedExpenses] = useState<
    Array<{
      id: string
      expenseDate: Date
      expenseTimeZone: string
      recurrenceSequence: number | null
      title: string
      amount: number
    }>
  >([])
  useEffect(() => {
    if (!open) return
    // oxlint-disable-next-line react/react-compiler -- reset dialog-local pagination when its target changes.
    setOccurrenceCursor(undefined)
    setLoadedExpenses([])
  }, [open, seriesId])
  const groupQuery = trpc.groups.get.useQuery(
    { groupId, linkInviteToken },
    { enabled: open },
  )
  const seriesQuery = trpc.groups.expenses.series.useQuery(
    {
      groupId,
      seriesId,
      limit: 1,
      occurrenceCursor,
      occurrenceLimit: 50,
      linkInviteToken,
    },
    { enabled: open },
  )
  const currency = groupQuery.data?.group
    ? getCurrencyFromGroup(groupQuery.data.group)
    : null
  const series = seriesQuery.data?.series.find((item) => item.id === seriesId)
  useEffect(() => {
    if (!series || !seriesQuery.data) return
    // oxlint-disable-next-line react/react-compiler -- append newly fetched occurrences to dialog-local state.
    setLoadedExpenses((current) => {
      if (!occurrenceCursor) return series.expenses
      const seen = new Set(current.map((expense) => expense.id))
      return [
        ...current,
        ...series.expenses.filter((expense) => !seen.has(expense.id)),
      ]
    })
  }, [occurrenceCursor, series, seriesQuery.data])
  const hasMoreOccurrences = Boolean(series?.hasMoreOccurrences)
  const nextOccurrenceCursor = series?.nextOccurrenceCursor ?? undefined

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <RecurringBadge status={series?.status} />
            {t('title')}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {series
              ? t('occurrences', { count: loadedExpenses.length })
              : t('empty')}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="max-h-[65vh] space-y-2 overflow-y-auto">
          {series && (
            <p className="text-sm text-muted-foreground">
              {t('timeZone', { timeZone: series.timeZone })}
            </p>
          )}
          {seriesQuery.isLoading && (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}
          {!seriesQuery.isLoading && series && currency && (
            <ol className="divide-y rounded-md border">
              {loadedExpenses.map((expense) => (
                <li key={expense.id}>
                  <Link
                    to="/groups/$groupId/expenses/$expenseId"
                    params={{ groupId, expenseId: expense.id }}
                    search={
                      linkInviteToken ? { invite: linkInviteToken } : undefined
                    }
                    className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-accent focus-visible:bg-accent"
                    onClick={() => onOpenChange(false)}
                  >
                    <span className="w-7 text-center text-xs text-muted-foreground tabular-nums">
                      {expense.recurrenceSequence}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {expense.title}
                      </span>
                      {(() => {
                        const d = formatExpenseClosed(
                          expense as never,
                          locale,
                          undefined,
                          tForm('dateTimePicker.yourTime' as never),
                        )
                        return (
                          <span
                            className="block text-xs text-muted-foreground"
                            title={d.tooltip}
                          >
                            {d.text}
                          </span>
                        )
                      })()}
                    </span>
                    <span className="text-sm font-semibold tabular-nums">
                      {formatCurrency(currency, expense.amount, locale)}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
          {!seriesQuery.isLoading &&
            series &&
            hasMoreOccurrences &&
            nextOccurrenceCursor && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setOccurrenceCursor(nextOccurrenceCursor)}
                disabled={seriesQuery.isFetching}
              >
                {seriesQuery.isFetching ? t('loading') : t('loadMore')}
              </Button>
            )}
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
