import type { TFunction } from 'i18next'

import { type Category, type CategoryId, getCategoryById } from '@spliit/domain'

const categoryColors = [
  '#0f766e',
  '#14b8a6',
  '#0ea5e9',
  '#f59e0b',
  '#f97316',
  '#8b5cf6',
] as const

export const otherCategoryColor = '#94a3b8'

export function getCategoryColor(index: number): string {
  return categoryColors[index % categoryColors.length]
}

export function categoryFromId(categoryId: CategoryId): Category {
  return getCategoryById(categoryId) ?? getCategoryById('general')!
}

export function categoryLabel(t: TFunction, categoryId: CategoryId): string {
  const category = categoryFromId(categoryId)
  const key =
    category.parentId === null
      ? `${category.grouping}.heading`
      : `${category.grouping}.${category.name}`
  return t(key as never, {
    ns: 'translation',
    keyPrefix: 'Categories',
  })
}
