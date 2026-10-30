import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useInView } from 'react-intersection-observer'

import { BulkCategorizeTable } from '@/app/groups/[groupId]/bulk-categorize/bulk-categorize-table'
import { trpc } from '@/trpc/client'
import type { CategoryId } from '@spliit/domain'

export function PersonalCategorizePagedReview({
  runId,
  reviewCycle,
  total,
  filter,
  remoteReviewVersion,
  disabled,
  aiMinConfidence,
  onChange,
}: {
  runId: string
  reviewCycle: string | null
  total: number
  filter: 'all' | 'general'
  remoteReviewVersion: number
  disabled: boolean
  aiMinConfidence: number
  onChange: (id: string, categoryId: CategoryId) => Promise<boolean>
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'BulkCategorize' })
  const [edits, setEdits] = useState<Map<string, CategoryId>>(new Map())
  const lastRemoteReviewVersion = useRef(remoteReviewVersion)
  const { ref: endRef, inView } = useInView({ rootMargin: '800px' })
  const page = trpc.personal.categorization.reviewPage.useInfiniteQuery(
    { runId, reviewCycle, filter, limit: 100 },
    { enabled: total > 0, getNextPageParam: ({ nextCursor }) => nextCursor },
  )
  const { hasNextPage, isFetchingNextPage, fetchNextPage, refetch } = page
  useEffect(() => {
    if (lastRemoteReviewVersion.current === remoteReviewVersion) return
    lastRemoteReviewVersion.current = remoteReviewVersion
    setEdits(new Map())
    void refetch()
  }, [remoteReviewVersion, refetch])
  const rows = useMemo(
    () =>
      (total === 0
        ? []
        : (page.data?.pages.flatMap((entry) => entry.rows) ?? [])
      )
        .map((row) => ({
          ...row,
          categoryId: edits.get(row.id) ?? row.categoryId,
        }))
        .filter((row) => filter === 'all' || row.categoryId === 'general'),
    [page.data, edits, filter, total],
  )
  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage])
  async function change(id: string, categoryId: CategoryId) {
    if (await onChange(id, categoryId))
      setEdits((current) => new Map(current).set(id, categoryId))
  }

  return (
    <div>
      <BulkCategorizeTable
        rows={rows}
        preserveOrder
        disabled={disabled}
        aiMinConfidence={aiMinConfidence}
        onChange={(id, categoryId) => void change(id, categoryId)}
      />
      <div ref={endRef} aria-hidden className="h-px" />
      {filter === 'general' && total === 0 && (
        <p className="p-6 text-center text-sm text-muted-foreground">
          {t('noGeneralRows')}
        </p>
      )}
      {page.isError && (
        <div role="alert" className="p-4 text-sm text-destructive">
          {t('pageLoadError')}{' '}
          <button
            type="button"
            className="cursor-pointer underline"
            onClick={() => void page.refetch()}
          >
            {t('pageRetry')}
          </button>
        </div>
      )}
      {page.isFetching && (
        <p className="p-3 text-center text-sm text-muted-foreground">
          {t('pageLoading')}
        </p>
      )}
      {!page.isFetching && rows.length > 0 && (
        <p className="p-2 text-center text-xs text-muted-foreground">
          {t('pageCount', { loaded: rows.length, total })}
        </p>
      )}
    </div>
  )
}
