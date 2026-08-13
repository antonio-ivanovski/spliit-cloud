import { useEffect, useMemo, useRef, useState } from 'react'
import { useFormState, useWatch, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useDebounce } from 'use-debounce'

import { categoryLabel } from '@/app/groups/[groupId]/stats/category-utils'
import { trpc } from '@/trpc/client'
import {
  DEFAULT_CATEGORIES,
  DEFAULT_CATEGORY_ID,
  createCategorySearchDocument,
  suggestCategoryFromTitle,
  type ExpenseFormInputValues,
} from '@spliit/domain'

const TITLE_SUGGEST_DEBOUNCE_MS = 250
const TITLE_SUGGEST_MAX_WAIT_MS = 1000

export function useSuggestCategoryFromTitle(args: {
  form: UseFormReturn<ExpenseFormInputValues>
  groupId: string
  locale: string
  readOnly: boolean
  enableCategoryExtract: boolean
  linkInviteToken?: string
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
    linkInviteToken,
    suggestCategoryMutation,
  } = args
  const { t } = useTranslation(undefined, { keyPrefix: 'Categories' })
  const [isCategoryLoading, setCategoryLoading] = useState(false)
  const categoryRequestRef = useRef(0)
  const categoryAbortRef = useRef<AbortController | null>(null)
  const categorySourceRef = useRef<'default' | 'manual' | 'ai'>(
    form.getValues('category') === DEFAULT_CATEGORY_ID ? 'default' : 'manual',
  )
  const lastCategorizedTitleRef = useRef<string | null>(null)
  const mutateAsync = suggestCategoryMutation.mutateAsync

  const titleValue = useWatch({ control: form.control, name: 'title' }) ?? ''
  const [debouncedTitle] = useDebounce(
    titleValue.trim(),
    TITLE_SUGGEST_DEBOUNCE_MS,
    {
      maxWait: TITLE_SUGGEST_MAX_WAIT_MS,
    },
  )

  const documents = useMemo(
    () =>
      DEFAULT_CATEGORIES.map((category) =>
        createCategorySearchDocument(category, {
          label: categoryLabel(t, category.id),
          grouping: category.parentId
            ? categoryLabel(t, category.parentId)
            : categoryLabel(t, category.id),
          locale,
        }),
      ),
    [locale, t],
  )

  const memoryQuery = trpc.groups.expenses.categoryMemory.useQuery(
    { groupId, linkInviteToken },
    { enabled: !readOnly },
  )
  const memory = memoryQuery.data?.expenses

  const { isSubmitting } = useFormState({ control: form.control })

  useEffect(() => {
    return () => {
      categoryAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!isSubmitting) return
    categoryAbortRef.current?.abort()
  }, [isSubmitting])

  useEffect(() => {
    const title = debouncedTitle
    const canSuggest =
      !readOnly &&
      title.length > 0 &&
      (categorySourceRef.current === 'default' ||
        categorySourceRef.current === 'ai') &&
      lastCategorizedTitleRef.current !== title

    if (!canSuggest) return

    const local = suggestCategoryFromTitle(title, documents, memory ?? [])
    if (local) {
      categoryRequestRef.current += 1
      categoryAbortRef.current?.abort()
      lastCategorizedTitleRef.current = title
      categorySourceRef.current = 'ai'
      // oxlint-disable-next-line react/react-compiler -- apply the local ranker result after the title debounce.
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
    setCategoryLoading(true)

    void mutateAsync({
      title,
      groupId,
      locale,
      allowAi: enableCategoryExtract,
      linkInviteToken,
    })
      .then(({ categoryId }) => {
        if (
          requestId !== categoryRequestRef.current ||
          abortController.signal.aborted ||
          form.getValues('title').trim() !== title ||
          (categorySourceRef.current !== 'default' &&
            categorySourceRef.current !== 'ai')
        ) {
          return
        }

        if (!categoryId) return

        categorySourceRef.current = 'ai'
        form.setValue('category', categoryId, {
          shouldDirty: true,
          shouldTouch: true,
          shouldValidate: true,
        })
      })
      .catch(() => {
        if (abortController.signal.aborted) return
      })
      .finally(() => {
        if (requestId === categoryRequestRef.current) {
          setCategoryLoading(false)
        }
      })
  }, [
    debouncedTitle,
    documents,
    enableCategoryExtract,
    form,
    groupId,
    linkInviteToken,
    locale,
    memory,
    mutateAsync,
    readOnly,
  ])

  const onManualCategory = () => {
    categoryRequestRef.current += 1
    categoryAbortRef.current?.abort()
    categorySourceRef.current = 'manual'
    setCategoryLoading(false)
    suggestCategoryMutation.reset?.()
  }

  return { isCategoryLoading, onManualCategory }
}
