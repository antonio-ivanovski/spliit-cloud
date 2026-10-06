import { DEFAULT_CATEGORY_ID, type CategoryId } from '@spliit/domain'

type ReviewRow = {
  categoryId: CategoryId
  initialCategoryId?: CategoryId
  rerunFeedback?: boolean
}

export function getRerunReviewState(
  rows: ReviewRow[],
  candidates: { general: number; uncertain: number },
) {
  const proposedCount = rows.filter(
    (row) =>
      row.initialCategoryId !== undefined &&
      row.initialCategoryId !== DEFAULT_CATEGORY_ID,
  ).length
  const changedCount = rows.filter(
    (row) =>
      row.rerunFeedback !== true &&
      row.initialCategoryId !== undefined &&
      row.initialCategoryId !== DEFAULT_CATEGORY_ID &&
      row.categoryId !== row.initialCategoryId,
  ).length
  const assignedCount = rows.filter(
    (row) =>
      row.rerunFeedback !== true &&
      row.initialCategoryId === DEFAULT_CATEGORY_ID &&
      row.categoryId !== DEFAULT_CATEGORY_ID,
  ).length
  const hasNewCorrection = rows.some(
    (row) =>
      row.initialCategoryId !== undefined &&
      row.categoryId !== row.initialCategoryId &&
      row.rerunFeedback !== true,
  )
  const hasRerunCandidates = candidates.general + candidates.uncertain > 0
  return {
    proposedCount,
    changedCount,
    assignedCount,
    hasCorrections: changedCount > 0 || assignedCount > 0,
    hasNewCorrection,
    hasRerunCandidates,
    canRerun: hasNewCorrection && hasRerunCandidates,
  }
}
