import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFormState, useWatch, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useDebounce } from 'use-debounce'

import { categoryLabel } from '@/app/groups/[groupId]/stats/category-utils'
import { useLocaleCategoryDictionary } from '@/lib/use-locale-category-dictionary'
import { trpc } from '@/trpc/client'
import {
  DEFAULT_CATEGORIES,
  DEFAULT_CATEGORY_ID,
  CATEGORY_CANDIDATE_NEAR_TIE_WINDOW,
  categorizeLocally,
  createCategorySearchDocument,
  meetsCategorySuggestLiveMinQueryLength,
  meetsCategorySuggestMinQueryLength,
  type CategoryLocalThresholds,
  type CategorySuggestion,
  type ExpenseFormInputValues,
} from '@spliit/domain'

import { useGroupAccessSearch } from '../../use-group-access-search'

const TITLE_SUGGEST_DEBOUNCE_MS = 600
const TITLE_SUGGEST_LOADING_DELAY_MS = 300

export function useSuggestCategoryFromTitle(args: {
  form: UseFormReturn<ExpenseFormInputValues>
  groupId: string
  locale: string
  readOnly: boolean
  enableCategoryExtract: boolean
  enableDictionarySuggest: boolean
  enableHistorySuggest: boolean
  localThresholds: CategoryLocalThresholds
  suggestCategoryMutation: ReturnType<
    typeof trpc.groups.expenses.suggestCategory.useMutation
  >
}) {
  const {
    form,
    groupId,
    locale,
    readOnly,
    enableCategoryExtract,
    enableDictionarySuggest,
    enableHistorySuggest,
    localThresholds,
    suggestCategoryMutation,
  } = args
  const { t } = useTranslation(undefined, { keyPrefix: 'Categories' })
  const [isCategoryLoading, setCategoryLoading] = useState(false)
  const [categoryCandidates, setCategoryCandidates] = useState<
    CategorySuggestion[]
  >([])
  const categoryRequestRef = useRef(0)
  const categoryAbortRef = useRef<AbortController | null>(null)
  const loadingDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const categorySourceRef = useRef<'default' | 'manual' | 'suggested'>(
    form.getValues('category') === DEFAULT_CATEGORY_ID ? 'default' : 'manual',
  )
  const lastCategorizedTitleRef = useRef<string | null>(null)
  const mutateAsync = suggestCategoryMutation.mutateAsync

  const clearLoadingDelay = useCallback(() => {
    if (loadingDelayRef.current) {
      clearTimeout(loadingDelayRef.current)
      loadingDelayRef.current = null
    }
  }, [])

  const titleValue = useWatch({ control: form.control, name: 'title' }) ?? ''
  const [debouncedTitle] = useDebounce(
    titleValue.trim(),
    TITLE_SUGGEST_DEBOUNCE_MS,
  )

  const localeDictionary = useLocaleCategoryDictionary(locale)

  const documents = useMemo(
    () =>
      DEFAULT_CATEGORIES.map((category) =>
        createCategorySearchDocument(category, {
          label: categoryLabel(t, category.id),
          grouping: category.parentId
            ? categoryLabel(t, category.parentId)
            : categoryLabel(t, category.id),
          locale,
          localeDictionary,
        }),
      ),
    [locale, localeDictionary, t],
  )

  const memoryQuery = trpc.groups.expenses.categoryMemory.useQuery(
    { groupId, ...useGroupAccessSearch() },
    { enabled: !readOnly && enableHistorySuggest },
  )
  const memory = memoryQuery.data?.expenses
  const memoryReady =
    readOnly ||
    !enableHistorySuggest ||
    memoryQuery.isSuccess ||
    memoryQuery.isError

  const { isSubmitting } = useFormState({ control: form.control })

  useEffect(() => {
    return () => {
      clearLoadingDelay()
      categoryAbortRef.current?.abort()
    }
  }, [clearLoadingDelay])

  useEffect(() => {
    if (!isSubmitting) return
    clearLoadingDelay()
    categoryAbortRef.current?.abort()
    // oxlint-disable-next-line react/set-state-in-effect -- abort in-flight suggest on submit and clear delayed loading indicator.
    setCategoryLoading(false)
    setCategoryCandidates([])
  }, [clearLoadingDelay, isSubmitting])

  const triggerSuggest = useCallback(
    (rawTitle: string, isLive: boolean) => {
      const title = rawTitle.trim()
      const meetsGate = isLive
        ? meetsCategorySuggestLiveMinQueryLength(title)
        : meetsCategorySuggestMinQueryLength(title)
      const canSuggest =
        !readOnly &&
        memoryReady &&
        meetsGate &&
        (categorySourceRef.current === 'default' ||
          categorySourceRef.current === 'suggested') &&
        lastCategorizedTitleRef.current !== title

      if (!canSuggest) {
        // Stale guesses must not linger once the title no longer qualifies
        // (cleared or shortened below the length gate). A repeated trigger
        // for the same title keeps its chips.
        if (!meetsGate) setCategoryCandidates([])
        return
      }

      const local = categorizeLocally({
        title,
        documents,
        memory: memory ?? [],
        options: {
          dictionaryEnabled: enableDictionarySuggest,
          historyEnabled: enableHistorySuggest,
          thresholds: localThresholds,
        },
      })
      if (local.categoryId) {
        clearLoadingDelay()
        categoryRequestRef.current += 1
        categoryAbortRef.current?.abort()
        lastCategorizedTitleRef.current = title
        categorySourceRef.current = 'suggested'
        setCategoryLoading(false)
        form.setValue('category', local.categoryId, {
          shouldDirty: true,
          shouldTouch: true,
          shouldValidate: true,
        })
        // Single "other suggestions" chip on a near-tie dictionary hit —
        // same score scale, so the comparison is meaningful. History and AI
        // hits use different scales and never get a runner-up chip.
        if (local.primary?.source === 'dictionary') {
          const [runnerUp] = local.alternatives
          const nearTie =
            !!runnerUp &&
            local.primary.evidence.value - runnerUp.evidence.value <=
              CATEGORY_CANDIDATE_NEAR_TIE_WINDOW
          setCategoryCandidates(
            nearTie && runnerUp
              ? [
                  {
                    id: runnerUp.categoryId,
                    score: runnerUp.evidence.value,
                    source: 'dictionary',
                  },
                ]
              : [],
          )
        } else {
          setCategoryCandidates([])
        }
        return
      }
      setCategoryCandidates([])

      const requestId = ++categoryRequestRef.current
      categoryAbortRef.current?.abort()
      const abortController = new AbortController()
      categoryAbortRef.current = abortController
      lastCategorizedTitleRef.current = title
      clearLoadingDelay()
      loadingDelayRef.current = setTimeout(() => {
        if (
          requestId === categoryRequestRef.current &&
          !abortController.signal.aborted
        ) {
          setCategoryLoading(true)
        }
      }, TITLE_SUGGEST_LOADING_DELAY_MS)

      void mutateAsync({
        title,
        groupId,
        locale,
        allowAi: enableCategoryExtract,
      })
        .then(({ categoryId, candidates }) => {
          if (
            requestId !== categoryRequestRef.current ||
            abortController.signal.aborted ||
            form.getValues('title').trim() !== title ||
            (categorySourceRef.current !== 'default' &&
              categorySourceRef.current !== 'suggested')
          ) {
            return
          }

          // The AI engine's own runners-up double as guess chips (the applied
          // winner is already excluded server-side; on a miss the top pick is
          // included). When the AI did not run or had no usable runners, fall
          // back to dictionary guesses, which obey the dictionary flag.
          const chips =
            candidates.length > 0
              ? candidates
              : !categoryId && enableDictionarySuggest
                ? local.alternatives.map((choice) => ({
                    id: choice.categoryId,
                    score: choice.evidence.value,
                    source: 'dictionary' as const,
                  }))
                : []
          setCategoryCandidates(chips)
          if (!categoryId) return

          categorySourceRef.current = 'suggested'
          form.setValue('category', categoryId, {
            shouldDirty: true,
            shouldTouch: true,
            shouldValidate: true,
          })
        })
        .catch((error: unknown) => {
          if (abortController.signal.aborted) return
          if (error instanceof Error && error.name === 'AbortError') return
        })
        .finally(() => {
          clearLoadingDelay()
          if (requestId === categoryRequestRef.current) {
            setCategoryLoading(false)
          }
        })
    },
    [
      clearLoadingDelay,
      documents,
      enableCategoryExtract,
      enableDictionarySuggest,
      enableHistorySuggest,
      localThresholds,
      form,
      groupId,
      locale,
      memory,
      memoryReady,
      mutateAsync,
      readOnly,
    ],
  )

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- live debounced suggest may synchronously clear loading on a local dictionary/history hit.
    triggerSuggest(debouncedTitle, true)
  }, [debouncedTitle, triggerSuggest])

  const rawTitleMeetsGate = meetsCategorySuggestMinQueryLength(
    titleValue.trim(),
  )
  useEffect(() => {
    // Guess chips must follow the raw title, not the debounced one: the
    // debounced trigger never reruns when the debounced value is unchanged
    // (e.g. typed then cleared within one debounce window), which would
    // leave chips for a title that no longer qualifies.
    // oxlint-disable-next-line react/set-state-in-effect -- drop stale guess chips the moment the raw title stops qualifying.
    if (!rawTitleMeetsGate) setCategoryCandidates([])
  }, [rawTitleMeetsGate])

  const onManualCategory = useCallback(() => {
    clearLoadingDelay()
    categoryRequestRef.current += 1
    categoryAbortRef.current?.abort()
    categorySourceRef.current = 'manual'
    setCategoryLoading(false)
    setCategoryCandidates([])
    suggestCategoryMutation.reset?.()
  }, [clearLoadingDelay, suggestCategoryMutation])

  const onPickCandidate = useCallback(
    (categoryId: CategorySuggestion['id']) => {
      form.setValue('category', categoryId, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      })
      // A tapped guess is an explicit pick: lock the category like a manual
      // selection so further typing does not overwrite it.
      onManualCategory()
    },
    [form, onManualCategory],
  )

  const onTitleBlur = useCallback(() => {
    triggerSuggest(form.getValues('title') ?? '', false)
  }, [form, triggerSuggest])

  return {
    isCategoryLoading,
    onManualCategory,
    onTitleBlur,
    categoryCandidates,
    onPickCandidate,
  }
}
