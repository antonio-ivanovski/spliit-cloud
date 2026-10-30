import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
} from '@tanstack/react-query'

import { getTrpcClient } from '@/trpc/client'

import type {
  PersonalAttachment,
  PersonalEntryFilter,
  PersonalEntryInput,
  PersonalOverview,
  PersonalProfile,
  PersonalRecurringSeries,
  PersonalRecurringUpcoming,
  PersonalSources,
  PersonalTransactionsResult,
} from './types'
import type { PersonalBudget } from './types'

/**
 * Typed hook wrappers for the `personal.*` tRPC procedures.
 *
 * The API router is being built in parallel, so these hooks call the vanilla
 * client through a locally-declared procedure shape (mirroring
 * `handoff/personal-expenses-implementation.md`) instead of
 * `AppRouterOutput['personal']`. Once `personal` lands in `AppRouter`, replace
 * `PersonalClient` with the generated router type — the hook signatures stay
 * the same. Queries never retry: a missing procedure surfaces as an error
 * state, not a spinner loop.
 */

export type PersonalBudgetInput = {
  name: string
  amount: number
  period?: 'MONTHLY'
  categoryScope: 'ALL' | 'SELECTED'
  categoryIds: string[]
  startDay?: number
}

export type PersonalRecurringInput = {
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval: number
  anchorDate: string
  end:
    | { type: 'INDEFINITE' }
    | { type: 'COUNT'; count: number }
    | { type: 'DATE'; endDate: string }
  kind: 'EXPENSE' | 'INCOME'
  amount: number
  categoryId: string
  title?: string
  note?: string
}

export type PersonalRecurringPatch = {
  kind?: 'EXPENSE' | 'INCOME'
  amount?: number
  categoryId?: string
  title?: string | null
  note?: string | null
  end?: PersonalRecurringInput['end']
}

type PersonalClient = {
  personal: {
    profile: {
      get: { query: () => Promise<PersonalProfile> }
      update: {
        mutate: (input: Partial<PersonalProfile>) => Promise<PersonalProfile>
      }
    }
    transactions: {
      list: {
        query: (
          filter: PersonalEntryFilter,
        ) => Promise<PersonalTransactionsResult>
      }
      create: {
        mutate: (input: {
          requestId: string
          entry: PersonalEntryInput
        }) => Promise<{ id: string }>
      }
      update: {
        mutate: (input: {
          id: string
          expectedVersion?: number
          entry: Partial<PersonalEntryInput>
        }) => Promise<{ id: string }>
      }
      delete: { mutate: (input: { id: string }) => Promise<{ ok: true }> }
      setCategory: {
        mutate: (input: {
          id: string
          categoryId: string
          expectedVersion?: number
        }) => Promise<{ id: string }>
      }
      exclude: { mutate: (input: { id: string }) => Promise<{ ok: true }> }
      attachments: {
        add: {
          mutate: (input: {
            transactionId: string
            expectedVersion?: number
            attachment: {
              url: string
              fileName?: string
              contentType?: string
              width?: number
              height?: number
            }
          }) => Promise<PersonalAttachment>
        }
        remove: {
          mutate: (input: {
            transactionId: string
            attachmentId: string
            expectedVersion?: number
          }) => Promise<{ ok: true }>
        }
      }
      suggestCategory: {
        mutate: (input: {
          title: string
          locale?: string
          allowAi?: boolean
        }) => Promise<{
          categoryId: string | null
          candidates: Array<{ id: string; score: number; source: 'ai' }>
        }>
      }
      autoCategorize: {
        mutate: (input?: { limit?: number }) => Promise<{
          scanned: number
          applied: number
          skipped: number
        }>
      }
      exportCsv: {
        query: (filter: PersonalEntryFilter) => Promise<{
          filename: string
          csv: string
          truncated: boolean
        }>
      }
    }
    overview: {
      get: {
        query: (input: { month?: string }) => Promise<PersonalOverview>
      }
    }
    recurring: {
      list: { query: () => Promise<{ series: PersonalRecurringSeries[] }> }
      create: {
        mutate: (input: {
          requestId: string
          series: PersonalRecurringInput
        }) => Promise<{ id: string }>
      }
      update: {
        mutate: (input: {
          id: string
          expectedVersion?: number
          patch: PersonalRecurringPatch
        }) => Promise<{ id: string }>
      }
      pause: { mutate: (input: { id: string }) => Promise<{ id: string }> }
      resume: {
        mutate: (input: {
          id: string
        }) => Promise<{ id: string; skipped: number }>
      }
      cancel: { mutate: (input: { id: string }) => Promise<{ id: string }> }
      delete: { mutate: (input: { id: string }) => Promise<{ ok: true }> }
      skipNext: {
        mutate: (input: { id: string }) => Promise<{ id: string; date: string }>
      }
      upcoming: {
        query: (input: {
          from?: string
          to?: string
          seriesId?: string
          limit?: number
        }) => Promise<{ occurrences: PersonalRecurringUpcoming[] }>
      }
    }
    budgets: {
      list: {
        query: () => Promise<{
          budgets: PersonalBudget[]
          overallBudget: PersonalBudget | null
        }>
      }
      create: {
        mutate: (input: PersonalBudgetInput) => Promise<{ id: string }>
      }
      update: {
        mutate: (input: {
          id: string
          budget: PersonalBudgetInput
        }) => Promise<{ id: string }>
      }
      archive: {
        mutate: (input: {
          id: string
          archived: boolean
        }) => Promise<{ id: string }>
      }
      delete: { mutate: (input: { id: string }) => Promise<{ ok: true }> }
    }
    sources: {
      list: { query: () => Promise<PersonalSources> }
      updateRule: {
        mutate: (input: {
          groupId: string
          included: boolean
          includeFrom?: string | null
        }) => Promise<{ synced: number }>
      }
      setExpenseOverride: {
        mutate: (input: {
          expenseId: string
          state?: 'INCLUDE' | 'EXCLUDE' | null
          categoryId?: string | null
        }) => Promise<{ included: boolean }>
      }
      reconcile: { mutate: () => Promise<{ synced: number }> }
    }
    expenses: {
      getStatus: {
        query: (input: { expenseId: string }) => Promise<{
          eligible: boolean
          included: boolean
          override: 'INCLUDE' | 'EXCLUDE' | null
        }>
      }
    }
    import: {
      preview: {
        mutate: (input: {
          rows: PersonalImportRequestRow[]
        }) => Promise<PersonalImportPreviewResult>
      }
      commit: {
        mutate: (input: {
          requestId: string
          rows: PersonalImportRequestRow[]
        }) => Promise<{ importedCount: number; transactionIds: string[] }>
      }
    }
  }
}

export type PersonalImportRequestRow = {
  rowId: string
  rowNumber: number
  source: { baseFingerprint: string; originFingerprint: string }
  externalId?: string | null
  sourceAccount?: string | null
  entry: {
    kind: 'EXPENSE' | 'INCOME'
    amount: number
    currencyCode?: string | null
    date: string
    categoryId: string
    title?: string | null
    note?: string | null
  }
  approvedDuplicateKeys?: string[]
}

export type PersonalImportMatch = {
  key: string
  kind: 'EXACT_IMPORT' | 'EXISTING_TRANSACTION' | 'CURRENT_FILE'
  transactionId: string | null
  sourceRowId: string | null
  title: string | null
  date: string | null
  amount: number | null
  currency: string | null
  source: 'PERSONAL' | 'GROUP' | null
}

export type PersonalImportPreviewResult = {
  rows: Array<{
    rowId: string
    rowNumber: number
    matches: PersonalImportMatch[]
  }>
}

function getPersonalClient(): PersonalClient {
  return getTrpcClient() as unknown as PersonalClient
}

export const personalQueryKeys = {
  all: ['personal'] as const,
  profile: () => ['personal', 'profile'] as const,
  overview: (month?: string) =>
    ['personal', 'overview', month ?? 'current'] as const,
  transactions: (filter: PersonalEntryFilter) =>
    ['personal', 'transactions', filter] as const,
  budgets: () => ['personal', 'budgets'] as const,
  sources: () => ['personal', 'sources'] as const,
  recurring: () => ['personal', 'recurring'] as const,
  recurringUpcoming: (limit?: number) =>
    ['personal', 'recurring', 'upcoming', limit ?? 10] as const,
}

type QueryOpts<T> = Omit<UseQueryOptions<T, Error>, 'queryKey' | 'queryFn'>

function noRetry(): { retry: false } {
  return { retry: false }
}

export function usePersonalProfile(opts?: QueryOpts<PersonalProfile>) {
  return useQuery({
    queryKey: personalQueryKeys.profile(),
    queryFn: () => getPersonalClient().personal.profile.get.query(),
    staleTime: 60_000,
    ...noRetry(),
    ...opts,
  })
}

export function usePersonalOverview(
  month?: string,
  opts?: QueryOpts<PersonalOverview>,
) {
  return useQuery({
    queryKey: personalQueryKeys.overview(month),
    queryFn: () =>
      getPersonalClient().personal.overview.get.query(month ? { month } : {}),
    staleTime: 30_000,
    ...noRetry(),
    ...opts,
  })
}

export function usePersonalTransactions(
  filter: PersonalEntryFilter,
  opts?: QueryOpts<PersonalTransactionsResult>,
) {
  return useQuery({
    queryKey: personalQueryKeys.transactions(filter),
    queryFn: () => getPersonalClient().personal.transactions.list.query(filter),
    staleTime: 30_000,
    ...noRetry(),
    ...opts,
  })
}

export function usePersonalBudgets(
  opts?: QueryOpts<{
    budgets: PersonalBudget[]
    overallBudget: PersonalBudget | null
  }>,
) {
  return useQuery({
    queryKey: personalQueryKeys.budgets(),
    queryFn: () => getPersonalClient().personal.budgets.list.query(),
    staleTime: 30_000,
    ...noRetry(),
    ...opts,
  })
}

export function usePersonalSources(opts?: QueryOpts<PersonalSources>) {
  return useQuery({
    queryKey: personalQueryKeys.sources(),
    queryFn: () => getPersonalClient().personal.sources.list.query(),
    staleTime: 30_000,
    ...noRetry(),
    ...opts,
  })
}

function useInvalidatePersonal() {
  const queryClient = useQueryClient()
  return (keys: ReadonlyArray<ReadonlyArray<unknown>> = []) =>
    Promise.all(
      (keys.length > 0 ? keys : [personalQueryKeys.all]).map((key) =>
        queryClient.invalidateQueries({ queryKey: key }),
      ),
    )
}

type MutationOpts<TData, TVariables> = Omit<
  UseMutationOptions<TData, Error, TVariables>,
  'mutationFn'
>

export function usePersonalRecurringList(
  opts?: QueryOpts<{ series: PersonalRecurringSeries[] }>,
) {
  return useQuery({
    queryKey: personalQueryKeys.recurring(),
    queryFn: () => getPersonalClient().personal.recurring.list.query(),
    staleTime: 30_000,
    ...noRetry(),
    ...opts,
  })
}

export function usePersonalRecurringUpcoming(
  limit = 10,
  opts?: QueryOpts<{ occurrences: PersonalRecurringUpcoming[] }>,
) {
  return useQuery({
    queryKey: personalQueryKeys.recurringUpcoming(limit),
    queryFn: () =>
      getPersonalClient().personal.recurring.upcoming.query({ limit }),
    staleTime: 30_000,
    ...noRetry(),
    ...opts,
  })
}

function useInvalidatePersonalAndRecurring() {
  const invalidate = useInvalidatePersonal()
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      invalidate(),
      queryClient.invalidateQueries({
        queryKey: personalQueryKeys.recurring(),
      }),
      queryClient.invalidateQueries({
        queryKey: ['personal', 'recurring', 'upcoming'],
      }),
    ])
}

export function useCreatePersonalRecurring(
  opts?: MutationOpts<
    { id: string },
    { requestId: string; series: PersonalRecurringInput }
  >,
) {
  const invalidate = useInvalidatePersonalAndRecurring()
  return useMutation({
    mutationFn: (input: {
      requestId: string
      series: PersonalRecurringInput
    }) => getPersonalClient().personal.recurring.create.mutate(input),
    onSettled: () => {
      void invalidate()
    },
    ...opts,
  })
}

export function useUpdatePersonalRecurring(
  opts?: MutationOpts<
    { id: string },
    { id: string; expectedVersion?: number; patch: PersonalRecurringPatch }
  >,
) {
  const invalidate = useInvalidatePersonalAndRecurring()
  return useMutation({
    mutationFn: (input: {
      id: string
      expectedVersion?: number
      patch: PersonalRecurringPatch
    }) => getPersonalClient().personal.recurring.update.mutate(input),
    onSettled: () => {
      void invalidate()
    },
    ...opts,
  })
}

function usePersonalRecurringAction<
  TVariables extends { id: string },
  TData = { id: string },
>(
  run: (input: TVariables) => Promise<TData>,
  opts?: MutationOpts<TData, TVariables>,
) {
  const invalidate = useInvalidatePersonalAndRecurring()
  return useMutation({
    mutationFn: run,
    onSettled: () => {
      void invalidate()
    },
    ...opts,
  })
}

export function usePausePersonalRecurring(
  opts?: MutationOpts<{ id: string }, { id: string }>,
) {
  return usePersonalRecurringAction(
    (input: { id: string }) =>
      getPersonalClient().personal.recurring.pause.mutate(input),
    opts,
  )
}

export function useResumePersonalRecurring(
  opts?: MutationOpts<{ id: string; skipped: number }, { id: string }>,
) {
  return usePersonalRecurringAction(
    (input: { id: string }) =>
      getPersonalClient().personal.recurring.resume.mutate(input),
    opts,
  )
}

export function useCancelPersonalRecurring(
  opts?: MutationOpts<{ id: string }, { id: string }>,
) {
  return usePersonalRecurringAction(
    (input: { id: string }) =>
      getPersonalClient().personal.recurring.cancel.mutate(input),
    opts,
  )
}

export function useDeletePersonalRecurring(
  opts?: MutationOpts<{ ok: true }, { id: string }>,
) {
  return usePersonalRecurringAction(
    (input: { id: string }) =>
      getPersonalClient().personal.recurring.delete.mutate(input),
    opts,
  )
}

export function useSkipNextPersonalRecurring(
  opts?: MutationOpts<{ id: string; date: string }, { id: string }>,
) {
  return usePersonalRecurringAction(
    (input: { id: string }) =>
      getPersonalClient().personal.recurring.skipNext.mutate(input),
    opts,
  )
}

export function useUpdatePersonalProfile(
  opts?: MutationOpts<PersonalProfile, Partial<PersonalProfile>>,
) {
  const invalidate = useInvalidatePersonal()
  return useMutation({
    mutationFn: (input: Partial<PersonalProfile>) =>
      getPersonalClient().personal.profile.update.mutate(input),
    onSettled: () => {
      void invalidate([
        personalQueryKeys.profile(),
        personalQueryKeys.sources(),
        personalQueryKeys.overview(),
      ])
    },
    ...opts,
  })
}

export function useCreatePersonalTransaction(
  opts?: MutationOpts<
    { id: string },
    { requestId: string; entry: PersonalEntryInput }
  >,
) {
  const invalidate = useInvalidatePersonal()
  return useMutation({
    mutationFn: (input: { requestId: string; entry: PersonalEntryInput }) =>
      getPersonalClient().personal.transactions.create.mutate(input),
    onSettled: () => {
      void invalidate()
    },
    ...opts,
  })
}

export function useUpdatePersonalTransaction(
  opts?: MutationOpts<
    { id: string },
    { id: string; entry: Partial<PersonalEntryInput> }
  >,
) {
  const invalidate = useInvalidatePersonal()
  return useMutation({
    mutationFn: (input: {
      id: string
      expectedVersion?: number
      entry: Partial<PersonalEntryInput>
    }) => getPersonalClient().personal.transactions.update.mutate(input),
    onSettled: () => {
      void invalidate()
    },
    ...opts,
  })
}

export function useDeletePersonalTransaction(
  opts?: MutationOpts<{ ok: true }, { id: string }>,
) {
  const invalidate = useInvalidatePersonal()
  return useMutation({
    mutationFn: (input: { id: string }) =>
      getPersonalClient().personal.transactions.delete.mutate(input),
    onSettled: () => {
      void invalidate()
    },
    ...opts,
  })
}

export function useSetPersonalEntryCategory(
  opts?: MutationOpts<{ id: string }, { id: string; categoryId: string }>,
) {
  const invalidate = useInvalidatePersonal()
  return useMutation({
    mutationFn: (input: {
      id: string
      categoryId: string
      expectedVersion?: number
    }) => getPersonalClient().personal.transactions.setCategory.mutate(input),
    onSettled: () => {
      void invalidate()
    },
    ...opts,
  })
}

export function useSuggestPersonalCategory(
  opts?: MutationOpts<
    {
      categoryId: string | null
      candidates: Array<{ id: string; score: number; source: 'ai' }>
    },
    { title: string; locale?: string; allowAi?: boolean }
  >,
) {
  return useMutation({
    mutationFn: (input: {
      title: string
      locale?: string
      allowAi?: boolean
    }) =>
      getPersonalClient().personal.transactions.suggestCategory.mutate(input),
    ...opts,
  })
}

export function useAutoCategorizePersonal(
  opts?: MutationOpts<
    { scanned: number; applied: number },
    { limit?: number } | undefined
  >,
) {
  const invalidate = useInvalidatePersonal()
  return useMutation({
    mutationFn: (input?: { limit?: number }) =>
      getPersonalClient().personal.transactions.autoCategorize.mutate(input),
    onSettled: () => {
      void invalidate()
    },
    ...opts,
  })
}

export function useExportPersonalTransactions(
  opts?: MutationOpts<
    { filename: string; csv: string; truncated: boolean },
    PersonalEntryFilter
  >,
) {
  return useMutation({
    mutationFn: (filter: PersonalEntryFilter) =>
      getPersonalClient().personal.transactions.exportCsv.query(filter),
    ...opts,
  })
}

export function useExcludePersonalEntry(
  opts?: MutationOpts<{ ok: true }, { id: string }>,
) {
  const invalidate = useInvalidatePersonal()
  return useMutation({
    mutationFn: (input: { id: string }) =>
      getPersonalClient().personal.transactions.exclude.mutate(input),
    onSettled: () => {
      void invalidate()
    },
    ...opts,
  })
}

export type PersonalAttachmentInput = {
  url: string
  fileName?: string
  contentType?: string
  width?: number
  height?: number
}

export function useAddPersonalAttachment(
  opts?: MutationOpts<
    PersonalAttachment,
    {
      transactionId: string
      expectedVersion?: number
      attachment: PersonalAttachmentInput
    }
  >,
) {
  const invalidate = useInvalidatePersonal()
  return useMutation({
    mutationFn: (input: {
      transactionId: string
      expectedVersion?: number
      attachment: PersonalAttachmentInput
    }) =>
      getPersonalClient().personal.transactions.attachments.add.mutate(input),
    onSettled: () => {
      void invalidate()
    },
    ...opts,
  })
}

export function useRemovePersonalAttachment(
  opts?: MutationOpts<
    { ok: true },
    { transactionId: string; attachmentId: string; expectedVersion?: number }
  >,
) {
  const invalidate = useInvalidatePersonal()
  return useMutation({
    mutationFn: (input: {
      transactionId: string
      attachmentId: string
      expectedVersion?: number
    }) =>
      getPersonalClient().personal.transactions.attachments.remove.mutate(
        input,
      ),
    onSettled: () => {
      void invalidate()
    },
    ...opts,
  })
}

export function useCreatePersonalBudget(
  opts?: MutationOpts<{ id: string }, PersonalBudgetInput>,
) {
  const invalidate = useInvalidatePersonal()
  return useMutation({
    mutationFn: (input: PersonalBudgetInput) =>
      getPersonalClient().personal.budgets.create.mutate(input),
    onSettled: () => {
      void invalidate([
        personalQueryKeys.budgets(),
        personalQueryKeys.overview(),
      ])
    },
    ...opts,
  })
}

export function useUpdatePersonalBudget(
  opts?: MutationOpts<{ id: string }, { id: string } & PersonalBudgetInput>,
) {
  const invalidate = useInvalidatePersonal()
  return useMutation({
    mutationFn: ({ id, ...budget }: { id: string } & PersonalBudgetInput) =>
      getPersonalClient().personal.budgets.update.mutate({ id, budget }),
    onSettled: () => {
      void invalidate([
        personalQueryKeys.budgets(),
        personalQueryKeys.overview(),
      ])
    },
    ...opts,
  })
}

export function useArchivePersonalBudget(
  opts?: MutationOpts<{ id: string }, { id: string; archived: boolean }>,
) {
  const invalidate = useInvalidatePersonal()
  return useMutation({
    mutationFn: (input: { id: string; archived: boolean }) =>
      getPersonalClient().personal.budgets.archive.mutate(input),
    onSettled: () => {
      void invalidate([
        personalQueryKeys.budgets(),
        personalQueryKeys.overview(),
      ])
    },
    ...opts,
  })
}

export function useDeletePersonalBudget(
  opts?: MutationOpts<{ ok: true }, { id: string }>,
) {
  const invalidate = useInvalidatePersonal()
  return useMutation({
    mutationFn: (input: { id: string }) =>
      getPersonalClient().personal.budgets.delete.mutate(input),
    onSettled: () => {
      void invalidate([
        personalQueryKeys.budgets(),
        personalQueryKeys.overview(),
      ])
    },
    ...opts,
  })
}

export function useUpdatePersonalSourceRule(
  opts?: MutationOpts<
    { synced: number },
    { groupId: string; included: boolean; includeFrom?: string | null }
  >,
) {
  const invalidate = useInvalidatePersonal()
  return useMutation({
    mutationFn: (input: {
      groupId: string
      included: boolean
      includeFrom?: string | null
    }) => getPersonalClient().personal.sources.updateRule.mutate(input),
    onSettled: () => {
      void invalidate()
    },
    ...opts,
  })
}

export function useReconcilePersonalSources(
  opts?: MutationOpts<{ synced: number }, void>,
) {
  const invalidate = useInvalidatePersonal()
  return useMutation({
    mutationFn: () => getPersonalClient().personal.sources.reconcile.mutate(),
    onSettled: () => {
      void invalidate()
    },
    ...opts,
  })
}

export function usePreviewPersonalImport(
  opts?: MutationOpts<
    PersonalImportPreviewResult,
    { rows: PersonalImportRequestRow[] }
  >,
) {
  return useMutation({
    mutationFn: (input: { rows: PersonalImportRequestRow[] }) =>
      getPersonalClient().personal.import.preview.mutate(input),
    ...opts,
  })
}

export function useCommitPersonalImport(
  opts?: MutationOpts<
    { importedCount: number; transactionIds: string[] },
    { requestId: string; rows: PersonalImportRequestRow[] }
  >,
) {
  const invalidate = useInvalidatePersonal()
  return useMutation({
    mutationFn: (input: {
      requestId: string
      rows: PersonalImportRequestRow[]
    }) => getPersonalClient().personal.import.commit.mutate(input),
    onSettled: () => {
      void invalidate()
    },
    ...opts,
  })
}

/**
 * Feature gate for the Personal section. Reads `features.get` through a plain
 * query (not the `trpc.*.useQuery` proxy path) so partially-mocked clients —
 * and a backend that has not shipped the flag yet — resolve to a safe answer
 * instead of throwing during render. An absent flag defaults to visible; an
 * unreachable procedure or explicit `false` hides the section.
 */
export function usePersonalFeature(): {
  enabled: boolean
  isLoading: boolean
} {
  const query = useQuery({
    queryKey: ['personal', 'feature-flag'],
    queryFn: async (): Promise<boolean> => {
      try {
        const client = (typeof getTrpcClient === 'function'
          ? getTrpcClient()
          : undefined) as unknown as
          | { features?: { get?: { query?: () => Promise<unknown> } } }
          | undefined
        const run = client?.features?.get?.query
        if (typeof run !== 'function') return false
        const data = await run()
        return (
          (data as { enablePersonalFinance?: boolean } | undefined)
            ?.enablePersonalFinance ?? true
        )
      } catch {
        return false
      }
    },
    staleTime: Infinity,
    gcTime: Infinity,
    ...noRetry(),
  })
  return { enabled: query.data ?? false, isLoading: query.isPending }
}
