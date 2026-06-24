import * as z from 'zod'

/**
 * Default categories and groupings used across the app.
 *
 * Categories are stored on `Expense.categoryId` as a string slug. The
 * display `name` of each category is a translation key (e.g. `"Movies"`)
 * that is resolved against the `Categories.<grouping>.<name>` message
 * path. The `grouping` is also used as a translation key to fetch the
 * grouping heading.
 *
 * We keep this list in code (rather than seeding a `Category` table) so
 * that:
 *  - the same names/groupings feed i18n without a DB roundtrip;
 *  - there is no need to seed a fresh database for a list of static
 *    values.
 *
 * When user-created categories are introduced in a future change, the
 * `Category` table will be re-added; the in-code ids will be reserved
 * for the defaults and a new id namespace will be introduced alongside.
 */

export type CategoryDefinition<Id extends string = string> = {
  /** Stable id stored on `Expense.categoryId` and in API responses. */
  id: Id
  /** Translation key under the `Categories` message namespace. */
  grouping: string
  /** Translation key under the `<grouping>` message namespace. */
  name: string
}

function defineCategories<
  const Categories extends readonly CategoryDefinition[],
>(categories: Categories): Categories {
  return categories
}

/**
 * Slug rules:
 *  - The id is the lower-kebab-case of the name when the name is unique
 *    across the whole list (e.g. `"Movies"` -> `"movies"`).
 *  - The id falls back to `<grouping>-<name>` slug when the name alone
 *    would be ambiguous across groupings (e.g. two categories named
 *    `"Home"` in different groupings).
 */
export const DEFAULT_CATEGORIES = defineCategories([
  { id: 'general', grouping: 'Uncategorized', name: 'General' },
  { id: 'payment', grouping: 'Uncategorized', name: 'Payment' },
  { id: 'entertainment', grouping: 'Entertainment', name: 'Entertainment' },
  { id: 'games', grouping: 'Entertainment', name: 'Games' },
  { id: 'movies', grouping: 'Entertainment', name: 'Movies' },
  { id: 'music', grouping: 'Entertainment', name: 'Music' },
  { id: 'sports', grouping: 'Entertainment', name: 'Sports' },
  {
    id: 'food-and-drink',
    grouping: 'Food and Drink',
    name: 'Food and Drink',
  },
  { id: 'dining-out', grouping: 'Food and Drink', name: 'Dining Out' },
  { id: 'groceries', grouping: 'Food and Drink', name: 'Groceries' },
  { id: 'liquor', grouping: 'Food and Drink', name: 'Liquor' },
  { id: 'home', grouping: 'Home', name: 'Home' },
  { id: 'electronics', grouping: 'Home', name: 'Electronics' },
  { id: 'furniture', grouping: 'Home', name: 'Furniture' },
  {
    id: 'household-supplies',
    grouping: 'Home',
    name: 'Household Supplies',
  },
  { id: 'maintenance', grouping: 'Home', name: 'Maintenance' },
  { id: 'mortgage', grouping: 'Home', name: 'Mortgage' },
  { id: 'pets', grouping: 'Home', name: 'Pets' },
  { id: 'rent', grouping: 'Home', name: 'Rent' },
  { id: 'services', grouping: 'Home', name: 'Services' },
  { id: 'childcare', grouping: 'Life', name: 'Childcare' },
  { id: 'clothing', grouping: 'Life', name: 'Clothing' },
  { id: 'education', grouping: 'Life', name: 'Education' },
  { id: 'gifts', grouping: 'Life', name: 'Gifts' },
  { id: 'insurance', grouping: 'Life', name: 'Insurance' },
  {
    id: 'medical-expenses',
    grouping: 'Life',
    name: 'Medical Expenses',
  },
  { id: 'taxes', grouping: 'Life', name: 'Taxes' },
  { id: 'transportation', grouping: 'Transportation', name: 'Transportation' },
  { id: 'bicycle', grouping: 'Transportation', name: 'Bicycle' },
  { id: 'bus-train', grouping: 'Transportation', name: 'Bus/Train' },
  { id: 'car', grouping: 'Transportation', name: 'Car' },
  { id: 'gas-fuel', grouping: 'Transportation', name: 'Gas/Fuel' },
  { id: 'hotel', grouping: 'Transportation', name: 'Hotel' },
  { id: 'parking', grouping: 'Transportation', name: 'Parking' },
  { id: 'plane', grouping: 'Transportation', name: 'Plane' },
  { id: 'taxi', grouping: 'Transportation', name: 'Taxi' },
  { id: 'utilities', grouping: 'Utilities', name: 'Utilities' },
  { id: 'cleaning', grouping: 'Utilities', name: 'Cleaning' },
  { id: 'electricity', grouping: 'Utilities', name: 'Electricity' },
  { id: 'heat-gas', grouping: 'Utilities', name: 'Heat/Gas' },
  { id: 'trash', grouping: 'Utilities', name: 'Trash' },
  {
    id: 'tv-phone-internet',
    grouping: 'Utilities',
    name: 'TV/Phone/Internet',
  },
  { id: 'water', grouping: 'Utilities', name: 'Water' },
  { id: 'donation', grouping: 'Life', name: 'Donation' },
])

export type Category = (typeof DEFAULT_CATEGORIES)[number]

/** Descriptive string id of a default category. */
export type CategoryId = Category['id']

export const CATEGORY_IDS = DEFAULT_CATEGORIES.map(
  (category) => category.id,
) as [CategoryId, ...CategoryId[]]

/**
 * Zod schema that constrains a category id to one of the in-code
 * defaults. Use this in any code that needs to validate an untyped
 * value (e.g. URL parameters, API inputs, JSON columns).
 */
export const categoryIdSchema = z.enum(CATEGORY_IDS)

/** Category used as the default selection on the expense form. */
export const DEFAULT_CATEGORY_ID: CategoryId = 'general'

/** Category used by reimbursement-style expenses (manual or auto). */
export const PAYMENT_CATEGORY_ID: CategoryId = 'payment'

/** Groupings derived from {@link DEFAULT_CATEGORIES}, in declared order. */
export const DEFAULT_GROUPINGS: ReadonlyArray<string> = Array.from(
  new Set(DEFAULT_CATEGORIES.map((category) => category.grouping)),
)

/**
 * Returns the category for an id, or `undefined` if no default category
 * matches. Useful when reading back `Expense.categoryId` from the DB.
 */
export function getCategoryById(id: CategoryId): Category | undefined {
  return DEFAULT_CATEGORIES.find((category) => category.id === id)
}
