import { useNavigate } from '@tanstack/react-router'

import { useMascotController } from '@/components/mascot/mascot-context'
import { useToast } from '@/components/ui/use-toast'
import { invalidateAccountGroupLists } from '@/lib/invalidate-account-groups'
import { trpc } from '@/trpc/client'
import { isSettlementCategory } from '@spliit/domain'

/**
 * Mirrors `getRecurringSeriesProgress`'s return shape. Kept inline so the web
 * package doesn't depend on @trpc/server; the procedure is the authoritative
 * source.
 */
type SeriesProgress = {
  seriesId: string
  status: string
  occurrencesCreated: number
  nextOccurrenceDate: string
  dueThrough: string | null
  pending: boolean
} | null

type InvalidateExpenseOptions = {
  groupId: string
  expenseId?: string
  financial?: boolean
}

const CATCH_UP_POLL_INTERVAL_MS = 1500
const CATCH_UP_POLL_TIMEOUT_MS = 30_000

export function invalidateExpenseDependencies(
  utils: ReturnType<typeof trpc.useUtils>,
  linkInviteToken: string | undefined,
  { groupId, expenseId, financial = true }: InvalidateExpenseOptions,
) {
  const tokens = { groupId, linkInviteToken }
  const globalExpenses = (
    utils as unknown as {
      expenses?: {
        list: { invalidate: () => Promise<unknown> }
        filterOptions: { invalidate: () => Promise<unknown> }
      }
    }
  ).expenses
  const tasks: Promise<unknown>[] = [
    utils.groups.expenses.list.invalidate(tokens),
    expenseId
      ? utils.groups.expenses.get.invalidate({
          groupId,
          expenseId,
          linkInviteToken,
        })
      : Promise.resolve(),
    utils.groups.expenses.series.invalidate(tokens),
    utils.groups.expenses.commonCurrencies.invalidate(tokens),
    utils.groups.activities.list.invalidate(tokens),
  ]
  if (globalExpenses) {
    tasks.push(
      globalExpenses.list.invalidate(),
      globalExpenses.filterOptions.invalidate(),
    )
  }
  if (financial) {
    // Financial mutations change per-group totals AND the account-wide group
    // list (recent activity, ledger summary) that the currency converter
    // consumes. Bust both so neither ranks against a stale summary.
    tasks.push(
      utils.groups.balances.list.invalidate({ groupId }),
      invalidateAccountGroupLists(utils),
    )
  }
  return Promise.all(tasks)
}

function useInvalidateExpenseDependencies(linkInviteToken: string | undefined) {
  const utils = trpc.useUtils()

  return (options: InvalidateExpenseOptions) =>
    invalidateExpenseDependencies(utils, linkInviteToken, options)
}

/**
 * Tracks the in-flight catch-up poll per series so overlapping creates don't
 * double-poll, and so a re-mount of the consumer does not leave a dangling
 * interval. Cancellation aborts the next scheduled tick.
 */
type CatchUpHandle = { abort: () => void }
const catchUpPolls = new Map<string, CatchUpHandle>()

function startCatchUpPoll(args: {
  utils: ReturnType<typeof trpc.useUtils>
  groupId: string
  seriesId: string
  linkInviteToken: string | undefined
  invalidate: () => Promise<unknown>
}) {
  const { seriesId } = args

  // Cancel any prior poll for this series; the latest create owns the work.
  const prior = catchUpPolls.get(seriesId)
  if (prior) prior.abort()

  let cancelled = false
  const handle: CatchUpHandle = {
    abort: () => {
      cancelled = true
    },
  }
  catchUpPolls.set(seriesId, handle)

  const startedAt = Date.now()
  let lastSeenOccurrences: number | null = null

  const finalize = async () => {
    if (catchUpPolls.get(seriesId) === handle) catchUpPolls.delete(seriesId)
    await args.invalidate()
  }

  const tick = async () => {
    if (cancelled) return
    if (Date.now() - startedAt > CATCH_UP_POLL_TIMEOUT_MS) {
      handle.abort()
      await finalize()
      return
    }
    let progress: SeriesProgress
    try {
      progress = await args.utils.groups.expenses.seriesProgress.fetch({
        groupId: args.groupId,
        seriesId: args.seriesId,
        linkInviteToken: args.linkInviteToken,
      })
    } catch {
      handle.abort()
      await finalize()
      return
    }
    if (cancelled) return
    if (!progress) {
      // Series disappeared (deleted, wrong group). Stop and refresh anyway.
      handle.abort()
      await finalize()
      return
    }
    const stillPending = progress.pending && progress.status === 'ACTIVE'
    if (!stillPending) {
      handle.abort()
      await finalize()
      return
    }
    if (
      lastSeenOccurrences !== null &&
      progress.occurrencesCreated !== lastSeenOccurrences
    ) {
      // Worker committed new occurrences between polls — re-render before
      // continuing to wait for the remainder.
      void args.invalidate()
    }
    lastSeenOccurrences = progress.occurrencesCreated
    setTimeout(tick, CATCH_UP_POLL_INTERVAL_MS)
  }

  void tick()
}

export function useUpdateExpenseMutation({
  linkInviteToken,
  onConflict,
}: {
  linkInviteToken: string | undefined
  onConflict?: () => void
}) {
  const { toast } = useToast()
  const mascot = useMascotController()
  const invalidateExpenseDependencies =
    useInvalidateExpenseDependencies(linkInviteToken)

  return trpc.groups.expenses.update.useMutation({
    onSuccess: (_data, variables) => {
      mascot.react('success')
      return invalidateExpenseDependencies({
        groupId: variables.groupId,
        expenseId: variables.expenseId,
      })
    },
    onError: (error) => {
      if (error.data?.code === 'CONFLICT') {
        onConflict?.()
        return
      }
      mascot.react('failure')
      toast({ description: error.message, variant: 'destructive' })
    },
  })
}

export function useCreateExpenseMutation({
  linkInviteToken,
}: {
  linkInviteToken: string | undefined
}) {
  const { toast } = useToast()
  const mascot = useMascotController()
  const utils = trpc.useUtils()
  const invalidateExpenseDependencies =
    useInvalidateExpenseDependencies(linkInviteToken)

  return trpc.groups.expenses.create.useMutation({
    onSuccess: (data, variables) => {
      mascot.react(
        isSettlementCategory(variables.expense.category)
          ? 'celebrate'
          : 'success',
      )
      // Fire-and-forget catch-up poll for past-dated series. The worker
      // materializes the remaining occurrences asynchronously; without
      // polling, expenses/activities/balances stay stale until an
      // unrelated refetch. Do not await — the create's caller is not
      // blocked on the worker draining.
      if (data.recurringSeriesId) {
        startCatchUpPoll({
          utils,
          groupId: variables.groupId,
          seriesId: data.recurringSeriesId,
          linkInviteToken,
          invalidate: () =>
            invalidateExpenseDependencies({
              groupId: variables.groupId,
              expenseId: data.expenseId,
            }),
        })
      }
      // Immediate invalidation: the anchor occurrence and any same-tick
      // catch-up the worker already committed are visible right away.
      return invalidateExpenseDependencies({
        groupId: variables.groupId,
        expenseId: data.expenseId,
      })
    },
    onError: (error) => {
      mascot.react('failure')
      toast({ description: error.message, variant: 'destructive' })
    },
  })
}

export function useDeleteExpenseMutation({
  linkInviteToken,
  onDeleted,
}: {
  linkInviteToken: string | undefined
  onDeleted?: () => void | Promise<void>
}) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const mascot = useMascotController()
  const invalidateExpenseDependencies =
    useInvalidateExpenseDependencies(linkInviteToken)

  return trpc.groups.expenses.delete.useMutation({
    onSuccess: async (_data, variables) => {
      mascot.react('acknowledge')
      // Invalidate first so the next render already shows the latest
      // state; stale cached list is not flashed.
      await invalidateExpenseDependencies({
        groupId: variables.groupId,
      })
      if (onDeleted) {
        await onDeleted()
      } else {
        await navigate({
          to: '/groups/$groupId/expenses',
          params: { groupId: variables.groupId },
          replace: true,
        })
      }
    },
    onError: (error) => {
      mascot.react('failure')
      toast({ description: error.message, variant: 'destructive' })
    },
  })
}

export function useStopRecurrenceMutation({
  linkInviteToken,
}: {
  linkInviteToken: string | undefined
}) {
  const invalidateExpenseDependencies =
    useInvalidateExpenseDependencies(linkInviteToken)

  return trpc.groups.expenses.stopRecurrence.useMutation({
    onSuccess: (_data, variables) =>
      invalidateExpenseDependencies({
        groupId: variables.groupId,
        expenseId: variables.expenseId,
        financial: false,
      }),
  })
}
