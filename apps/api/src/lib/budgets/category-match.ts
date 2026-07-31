import {
  categoryIdSchema,
  categoryMatchesSelection,
  normalizeCategoryId,
} from '@spliit/domain'

/**
 * Whether a stored expense category slug matches a selected budget category
 * (parent or child). Unknown category slugs and unknown selections never match,
 * so an invalid selection stays restrictive rather than matching everything.
 */
export function budgetCategoryMatches(
  selectedId: string,
  categoryId: string,
): boolean {
  const category = categoryIdSchema.safeParse(categoryId)
  if (!category.success) return false
  const selected = normalizeCategoryId(selectedId)
  if (!selected) return false
  return categoryMatchesSelection(category.data, [selected])
}
