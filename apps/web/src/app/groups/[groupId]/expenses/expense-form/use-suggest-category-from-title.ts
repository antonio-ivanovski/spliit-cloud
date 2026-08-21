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
  createCategorySearchDocument,
  meetsCategorySuggestLiveMinQueryLength,
  meetsCategorySuggestMinQueryLength,
  suggestCategoryFromTitle,
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
    suggestCategoryMutation,
  } = args
  const { t } = useTranslation(undefined, { keyPrefix: 'Categories' })
  const [isCategoryLoading, setCategoryLoading] = useState(false)
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
    { enabled: !readOnly },
  )
  const memory = memoryQuery.data?.expenses
  const memoryReady = readOnly || memoryQuery.isSuccess || memoryQuery.isError

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
    // oxlint-disable-next-line react/react-compiler -- abort in-flight suggest on submit and clear delayed loading indicator.
    setCategoryLoading(false)
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

      if (!canSuggest) return

      const local = suggestCategoryFromTitle(title, documents, memory ?? [])
      if (local) {
        clearLoadingDelay()
        categoryRequestRef.current += 1
        categoryAbortRef.current?.abort()
        lastCategorizedTitleRef.current = title
        categorySourceRef.current = 'suggested'
        setCategoryLoading(false)
        form.setValue('category', local.id, {
          shouldDirty: true,
          shouldTouch: true,
          shouldValidate: true,
        })
        return
      }

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
        .then(({ categoryId }) => {
          if (
            requestId !== categoryRequestRef.current ||
            abortController.signal.aborted ||
            form.getValues('title').trim() !== title ||
            (categorySourceRef.current !== 'default' &&
              categorySourceRef.current !== 'suggested')
          ) {
            return
          }

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
    // oxlint-disable-next-line react/react-compiler -- live debounced suggest may synchronously clear loading on a local dictionary/history hit.
    triggerSuggest(debouncedTitle, true)
  }, [debouncedTitle, triggerSuggest])

  const onManualCategory = useCallback(() => {
    clearLoadingDelay()
    categoryRequestRef.current += 1
    categoryAbortRef.current?.abort()
    categorySourceRef.current = 'manual'
    setCategoryLoading(false)
    suggestCategoryMutation.reset?.()
  }, [clearLoadingDelay, suggestCategoryMutation])

  const onTitleBlur = useCallback(() => {
    triggerSuggest(form.getValues('title') ?? '', false)
  }, [form, triggerSuggest])

  return { isCategoryLoading, onManualCategory, onTitleBlur }
}
