import * as z from 'zod'

/**
 * Default categories used across the app.
 *
 * Categories are stored on `Expense.categoryId` as a string slug. Parents and
 * children are both assignable: a parent id (e.g. `"home"`) means generic
 * spending in that group; a child id (e.g. `"rent"`) is more specific.
 *
 * Display names are translation keys under `Categories.<grouping>.<name>` for
 * children, and `Categories.<grouping>.heading` for parents (`parentId:
 * null`).
 *
 * We keep this list in code (rather than seeding a `Category` table) so that:
 *
 * - The same names/groupings feed i18n without a DB roundtrip;
 * - There is no need to seed a fresh database for a list of static values.
 *
 * When user-created categories are introduced in a future change, the
 * `Category` table will be re-added; the in-code ids will be reserved for the
 * defaults and a new id namespace will be introduced alongside.
 */

export type CategoryDefinition<Id extends string = string> = {
  /** Stable id stored on `Expense.categoryId` and in API responses. */
  id: Id
  /** Translation key under the `Categories` message namespace. */
  grouping: string
  /**
   * Translation key under the `<grouping>` message namespace for children.
   * Parents use the grouping `heading` key for display instead.
   */
  name: string
  /** `null` for top-level (parent) categories; otherwise the parent category id. */
  parentId: Id | null
}

function defineCategories<
  const Categories extends readonly CategoryDefinition[],
>(categories: Categories): Categories {
  return categories
}

/**
 * Slug rules:
 *
 * - The id is the lower-kebab-case of the name when the name is unique across the
 *   whole list (e.g. `"Movies"` -> `"movies"`).
 * - Parent ids reuse the former “mirror” leaf slugs where those existed (`home`,
 *   `entertainment`, …) so existing expense rows stay valid.
 * - Groups that never had a mirror get a new parent slug from the grouping
 *   (`life`, `uncategorized`, …).
 */
export const DEFAULT_CATEGORIES = defineCategories([
  // Uncategorized
  {
    id: 'uncategorized',
    grouping: 'Uncategorized',
    name: 'Uncategorized',
    parentId: null,
  },
  {
    id: 'general',
    grouping: 'Uncategorized',
    name: 'General',
    parentId: 'uncategorized',
  },
  {
    id: 'payment',
    grouping: 'Uncategorized',
    name: 'Payment',
    parentId: 'uncategorized',
  },
  // Income
  {
    id: 'income',
    grouping: 'Income',
    name: 'Income',
    parentId: null,
  },
  // Settlement
  {
    id: 'settlement',
    grouping: 'Settlement',
    name: 'Settlement',
    parentId: null,
  },
  // Entertainment
  {
    id: 'entertainment',
    grouping: 'Entertainment',
    name: 'Entertainment',
    parentId: null,
  },
  {
    id: 'games',
    grouping: 'Entertainment',
    name: 'Games',
    parentId: 'entertainment',
  },
  {
    id: 'movies',
    grouping: 'Entertainment',
    name: 'Movies',
    parentId: 'entertainment',
  },
  {
    id: 'music',
    grouping: 'Entertainment',
    name: 'Music',
    parentId: 'entertainment',
  },
  {
    id: 'sports',
    grouping: 'Entertainment',
    name: 'Sports',
    parentId: 'entertainment',
  },
  // Food and Drink
  {
    id: 'food-and-drink',
    grouping: 'Food and Drink',
    name: 'Food and Drink',
    parentId: null,
  },
  {
    id: 'dining-out',
    grouping: 'Food and Drink',
    name: 'Dining Out',
    parentId: 'food-and-drink',
  },
  {
    id: 'groceries',
    grouping: 'Food and Drink',
    name: 'Groceries',
    parentId: 'food-and-drink',
  },
  {
    id: 'liquor',
    grouping: 'Food and Drink',
    name: 'Liquor',
    parentId: 'food-and-drink',
  },
  // Home
  { id: 'home', grouping: 'Home', name: 'Home', parentId: null },
  {
    id: 'electronics',
    grouping: 'Home',
    name: 'Electronics',
    parentId: 'home',
  },
  { id: 'furniture', grouping: 'Home', name: 'Furniture', parentId: 'home' },
  {
    id: 'household-supplies',
    grouping: 'Home',
    name: 'Household Supplies',
    parentId: 'home',
  },
  {
    id: 'maintenance',
    grouping: 'Home',
    name: 'Maintenance',
    parentId: 'home',
  },
  { id: 'mortgage', grouping: 'Home', name: 'Mortgage', parentId: 'home' },
  {
    id: 'gardening',
    grouping: 'Home',
    name: 'Gardening',
    parentId: 'home',
  },
  { id: 'pets', grouping: 'Home', name: 'Pets', parentId: 'home' },
  {
    id: 'plants',
    grouping: 'Home',
    name: 'Plants',
    parentId: 'home',
  },
  { id: 'rent', grouping: 'Home', name: 'Rent', parentId: 'home' },
  { id: 'services', grouping: 'Home', name: 'Services', parentId: 'home' },
  // Life
  { id: 'life', grouping: 'Life', name: 'Life', parentId: null },
  { id: 'childcare', grouping: 'Life', name: 'Childcare', parentId: 'life' },
  { id: 'clothing', grouping: 'Life', name: 'Clothing', parentId: 'life' },
  { id: 'education', grouping: 'Life', name: 'Education', parentId: 'life' },
  { id: 'gifts', grouping: 'Life', name: 'Gifts', parentId: 'life' },
  { id: 'insurance', grouping: 'Life', name: 'Insurance', parentId: 'life' },
  {
    id: 'medical-expenses',
    grouping: 'Life',
    name: 'Medical Expenses',
    parentId: 'life',
  },
  { id: 'taxes', grouping: 'Life', name: 'Taxes', parentId: 'life' },
  { id: 'donation', grouping: 'Life', name: 'Donation', parentId: 'life' },
  // Transportation
  {
    id: 'transportation',
    grouping: 'Transportation',
    name: 'Transportation',
    parentId: null,
  },
  {
    id: 'bicycle',
    grouping: 'Transportation',
    name: 'Bicycle',
    parentId: 'transportation',
  },
  {
    id: 'bus-train',
    grouping: 'Transportation',
    name: 'Bus/Train',
    parentId: 'transportation',
  },
  {
    id: 'car',
    grouping: 'Transportation',
    name: 'Car',
    parentId: 'transportation',
  },
  {
    id: 'gas-fuel',
    grouping: 'Transportation',
    name: 'Gas/Fuel',
    parentId: 'transportation',
  },
  {
    id: 'hotel',
    grouping: 'Transportation',
    name: 'Hotel',
    parentId: 'transportation',
  },
  {
    id: 'parking',
    grouping: 'Transportation',
    name: 'Parking',
    parentId: 'transportation',
  },
  {
    id: 'plane',
    grouping: 'Transportation',
    name: 'Plane',
    parentId: 'transportation',
  },
  {
    id: 'taxi',
    grouping: 'Transportation',
    name: 'Taxi',
    parentId: 'transportation',
  },
  {
    id: 'tolls',
    grouping: 'Transportation',
    name: 'Tolls',
    parentId: 'transportation',
  },
  // Utilities
  {
    id: 'utilities',
    grouping: 'Utilities',
    name: 'Utilities',
    parentId: null,
  },
  {
    id: 'cleaning',
    grouping: 'Utilities',
    name: 'Cleaning',
    parentId: 'utilities',
  },
  {
    id: 'electricity',
    grouping: 'Utilities',
    name: 'Electricity',
    parentId: 'utilities',
  },
  {
    id: 'heat-gas',
    grouping: 'Utilities',
    name: 'Heat/Gas',
    parentId: 'utilities',
  },
  { id: 'trash', grouping: 'Utilities', name: 'Trash', parentId: 'utilities' },
  {
    id: 'tv-phone-internet',
    grouping: 'Utilities',
    name: 'TV/Phone/Internet',
    parentId: 'utilities',
  },
  { id: 'water', grouping: 'Utilities', name: 'Water', parentId: 'utilities' },
  // Social and Activities
  {
    id: 'social-and-activities',
    grouping: 'Social and Activities',
    name: 'Social and Activities',
    parentId: null,
  },
  {
    id: 'events-and-activities',
    grouping: 'Social and Activities',
    name: 'Events and Activities',
    parentId: 'social-and-activities',
  },
  // Subscriptions and Memberships
  {
    id: 'subscriptions-and-memberships',
    grouping: 'Subscriptions and Memberships',
    name: 'Subscriptions and Memberships',
    parentId: null,
  },
  {
    id: 'digital-subscriptions',
    grouping: 'Subscriptions and Memberships',
    name: 'Digital Subscriptions',
    parentId: 'subscriptions-and-memberships',
  },
  {
    id: 'memberships',
    grouping: 'Subscriptions and Memberships',
    name: 'Memberships',
    parentId: 'subscriptions-and-memberships',
  },
  // Personal Care and Wellness (parent-only — no children)
  {
    id: 'personal-care-and-wellness',
    grouping: 'Personal Care and Wellness',
    name: 'Personal Care and Wellness',
    parentId: null,
  },
])

export type Category = (typeof DEFAULT_CATEGORIES)[number]

/** Descriptive string id of a default category (parent or child). */
export type CategoryId = Category['id']

export const CATEGORY_IDS = DEFAULT_CATEGORIES.map(
  (category) => category.id,
) as [CategoryId, ...CategoryId[]]

/**
 * Zod schema that constrains a category id to one of the in-code defaults. Use
 * this in any code that needs to validate an untyped value (e.g. URL
 * parameters, API inputs, JSON columns).
 */
export const categoryIdSchema = z.enum(CATEGORY_IDS)

/** Category used as the default selection on the expense form. */
export const DEFAULT_CATEGORY_ID: CategoryId = 'general'

/** Ordinary spend category for transfers that are not settlements. */
export const PAYMENT_CATEGORY_ID: CategoryId = 'payment'

/** Category used for true income (negative amounts that are not refunds). */
export const INCOME_CATEGORY_ID: CategoryId = 'income'

/** Category that marks a settlement between participants (not spending). */
export const SETTLEMENT_CATEGORY_ID: CategoryId = 'settlement'

/** True when `categoryId` is the settlement category that excludes spend. */
export function isSettlementCategory(
  categoryId: string | null | undefined,
): boolean {
  return categoryId === SETTLEMENT_CATEGORY_ID
}

/** Parent categories in declaration order. */
export const PARENT_CATEGORIES = DEFAULT_CATEGORIES.filter(
  (category) => category.parentId === null,
)

/** Groupings derived from parent categories, in declared order. */
export const DEFAULT_GROUPINGS: ReadonlyArray<string> = PARENT_CATEGORIES.map(
  (category) => category.grouping,
)

const CATEGORY_BY_ID = new Map(
  DEFAULT_CATEGORIES.map((category) => [category.id, category] as const),
)

/**
 * Returns the category for an id, or `undefined` if no default category
 * matches. Useful when reading back `Expense.categoryId` from the DB.
 */
export function getCategoryById(id: string): Category | undefined {
  return CATEGORY_BY_ID.get(id as CategoryId)
}

export function isParentCategory(category: Category | CategoryId): boolean {
  const resolved =
    typeof category === 'string' ? getCategoryById(category) : category
  return resolved?.parentId === null
}

/** Direct children of a parent category (empty for parent-only groups). */
export function getChildCategories(
  parentId: CategoryId,
  categories: readonly Category[] = DEFAULT_CATEGORIES,
): Category[] {
  return categories.filter((category) => category.parentId === parentId)
}

export function getChildCategoryIds(
  parentId: CategoryId,
  categories: readonly Category[] = DEFAULT_CATEGORIES,
): CategoryId[] {
  return getChildCategories(parentId, categories).map((category) => category.id)
}

/**
 * Normalize a stored or URL category id. Accepts plain category ids and legacy
 * `group:<slug>` taxonomy parent ids from the previous model.
 */
export function normalizeCategoryId(id: string): CategoryId | null {
  if (id.startsWith('group:')) {
    const slug = id.slice('group:'.length)
    return getCategoryById(slug)?.id ?? null
  }
  return getCategoryById(id)?.id ?? null
}

/**
 * Expand a selected category to the set of expense category ids it matches: the
 * id itself plus all descendants.
 */
export function resolveCategorySelection(
  categoryId: CategoryId,
  categories: readonly Category[] = DEFAULT_CATEGORIES,
): CategoryId[] {
  const category = categories.find((candidate) => candidate.id === categoryId)
  if (!category) return []
  if (category.parentId !== null) return [category.id]

  const result: CategoryId[] = [category.id]
  for (const child of getChildCategories(category.id, categories)) {
    result.push(child.id)
  }
  return result
}

/** Expand selected parent/child ids without duplicates. */
export function expandCategorySelection(
  selectedIds: readonly string[],
  categories: readonly Category[] = DEFAULT_CATEGORIES,
): CategoryId[] {
  const expanded = new Set<CategoryId>()
  for (const rawId of selectedIds) {
    const id = normalizeCategoryId(rawId)
    if (!id) continue
    for (const categoryId of resolveCategorySelection(id, categories)) {
      expanded.add(categoryId)
    }
  }
  return Array.from(expanded)
}

/**
 * Normalize stored/API category selections to canonical ids without expanding
 * parents.
 */
export function normalizeCategorySelection(
  selectedIds: readonly string[],
  categories: readonly Category[] = DEFAULT_CATEGORIES,
): CategoryId[] {
  const normalized = new Set<CategoryId>()
  for (const rawId of selectedIds) {
    const id = normalizeCategoryId(rawId)
    if (!id || !categories.some((category) => category.id === id)) continue
    normalized.add(id)
  }
  return Array.from(normalized)
}

export function categoryMatchesSelection(
  categoryId: CategoryId,
  selectedIds: readonly string[],
  categories: readonly Category[] = DEFAULT_CATEGORIES,
): boolean {
  return expandCategorySelection(selectedIds, categories).includes(categoryId)
}

/**
 * Whether a row should show as checked given a multi-select storage list.
 * Parents mark all children checked; children mark themselves.
 */
export function isCategoryEffectivelySelected(
  categoryId: CategoryId,
  selectedIds: readonly CategoryId[],
  categories: readonly Category[] = DEFAULT_CATEGORIES,
): boolean {
  if (selectedIds.includes(categoryId)) return true
  const category = categories.find((candidate) => candidate.id === categoryId)
  if (category?.parentId && selectedIds.includes(category.parentId)) {
    return true
  }
  return false
}

/**
 * Display count for a multi-select: a selected parent with children contributes
 * `children.length`; a parent with no children contributes 1; each selected
 * child contributes 1.
 */
export function categorySelectionDisplayCount(
  selectedIds: readonly CategoryId[],
  categories: readonly Category[] = DEFAULT_CATEGORIES,
): number {
  let count = 0
  for (const id of selectedIds) {
    const category = categories.find((candidate) => candidate.id === id)
    if (!category) continue
    if (category.parentId === null) {
      const children = getChildCategoryIds(id, categories)
      count += children.length > 0 ? children.length : 1
    } else {
      count += 1
    }
  }
  return count
}

/**
 * Toggle a category in a multi-select list.
 *
 * - Selecting a parent stores only the parent id and drops its children.
 * - Deselecting a child while the parent is selected expands to the other
 *   children.
 * - Selecting the last remaining sibling collapses back to the parent.
 */
export function toggleCategorySelection(
  selectedIds: readonly CategoryId[],
  toggledId: CategoryId,
  categories: readonly Category[] = DEFAULT_CATEGORIES,
): CategoryId[] {
  const category = categories.find((candidate) => candidate.id === toggledId)
  if (!category) return [...selectedIds]

  if (category.parentId === null) {
    if (selectedIds.includes(toggledId)) {
      return selectedIds.filter((id) => id !== toggledId)
    }
    const childIds = new Set(getChildCategoryIds(toggledId, categories))
    return [
      ...selectedIds.filter((id) => id !== toggledId && !childIds.has(id)),
      toggledId,
    ]
  }

  const parentId = category.parentId
  if (selectedIds.includes(parentId)) {
    const siblings = getChildCategoryIds(parentId, categories)
    return [
      ...selectedIds.filter((id) => id !== parentId),
      ...siblings.filter((id) => id !== toggledId),
    ]
  }

  if (selectedIds.includes(toggledId)) {
    return selectedIds.filter((id) => id !== toggledId)
  }

  const next = [...selectedIds, toggledId]
  const siblings = getChildCategoryIds(parentId, categories)
  if (
    siblings.length > 0 &&
    siblings.every((siblingId) => next.includes(siblingId))
  ) {
    return [...next.filter((id) => !siblings.includes(id)), parentId]
  }
  return next
}

export type CategoryValidation = { valid: boolean; errors: string[] }

/** Validate uniqueness, parent references, and cycles. */
export function validateCategories(
  categories: readonly CategoryDefinition[],
): CategoryValidation {
  const errors: string[] = []
  const byId = new Map<string, CategoryDefinition>()
  for (const category of categories) {
    if (byId.has(category.id)) {
      errors.push(`Duplicate category id: ${category.id}`)
    }
    byId.set(category.id, category)
  }
  for (const category of categories) {
    if (category.parentId === null) continue
    const parent = byId.get(category.parentId)
    if (!parent) {
      errors.push(`Missing parent for category: ${category.id}`)
      continue
    }
    if (parent.parentId !== null) {
      errors.push(`Parent must be a top-level category: ${category.id}`)
    }
    if (category.parentId === category.id) {
      errors.push(`Cyclic category parent relationship at: ${category.id}`)
    }
  }
  return { valid: errors.length === 0, errors }
}

export function assertValidCategories(
  categories: readonly CategoryDefinition[],
): void {
  const result = validateCategories(categories)
  if (!result.valid) throw new Error(result.errors.join('; '))
}

// ---------------------------------------------------------------------------
// Backwards-compatible aliases (previous taxonomy API)
// ---------------------------------------------------------------------------

/** @deprecated Use {@link CategoryId}. */
export type TaxonomyNodeId = CategoryId
/** @deprecated Use {@link CategoryId}. */
export type TaxonomyGroupId = CategoryId
/** @deprecated Use {@link Category}. */
export type TaxonomyNode = Category
/** @deprecated Use {@link Category}. */
export type TaxonomyGroupNode = Category
/** @deprecated Use {@link Category}. */
export type TaxonomyCategoryNode = Category

/** @deprecated Use parent category ids directly. */
export function taxonomyGroupId(grouping: string): CategoryId {
  const parent = PARENT_CATEGORIES.find(
    (category) => category.grouping === grouping,
  )
  if (!parent) {
    throw new Error(`Unknown category grouping: ${grouping}`)
  }
  return parent.id
}

/** @deprecated Use {@link DEFAULT_CATEGORIES}. */
export const TAXONOMY_NODES = DEFAULT_CATEGORIES
/** @deprecated Use {@link DEFAULT_CATEGORIES}. */
export const CATEGORY_TAXONOMY = DEFAULT_CATEGORIES
/** @deprecated Use {@link DEFAULT_CATEGORIES}. */
export const DEFAULT_TAXONOMY = DEFAULT_CATEGORIES
/** @deprecated Use {@link PARENT_CATEGORIES}. */
export const TAXONOMY_GROUPS = PARENT_CATEGORIES

/** @deprecated Use {@link getCategoryById}. */
export function getTaxonomyNodeById(id: string): Category | undefined {
  return getCategoryById(normalizeCategoryId(id) ?? id)
}

/** @deprecated Use {@link resolveCategorySelection}. */
export const resolveTaxonomyNode = resolveCategorySelection
/** @deprecated Use {@link expandCategorySelection}. */
export const expandTaxonomySelection = expandCategorySelection
/** @deprecated Use {@link categoryMatchesSelection}. */
export const categoryMatchesTaxonomySelection = categoryMatchesSelection
/** @deprecated Use {@link validateCategories}. */
export const validateTaxonomy = validateCategories
/** @deprecated Use {@link assertValidCategories}. */
export const assertValidTaxonomy = assertValidCategories
