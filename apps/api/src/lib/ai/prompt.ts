import { localeLabels, type Locale } from '@spliit/domain'
import type { GroupContext, RecentExpense } from './context'

/**
 * Human-readable language name for the AI, e.g. "Español" or "日本語".
 * Returns `undefined` for unknown locales.
 */
export function resolveLanguageName(locale: string): string | undefined {
  return localeLabels[locale as Locale]
}

/**
 * Locale hint line. Soft hint — the user's app language doesn't force
 * the title language. Empty string when no locale is provided or the
 * locale is not a known one, letting callers compose without branching.
 */
export function buildLocaleHint(locale: string | undefined): string {
  const name = locale ? resolveLanguageName(locale) : undefined
  if (!name) return ''
  return `Context: The user's app language is ${name}. The expense title may be written in ${name}, but could also be in another language — treat this as a hint, not a rule.`
}

/**
 * Group context line. Empty string when no group is provided, letting
 * callers compose without conditional branching. Uses the ISO code when
 * available and falls back to the currency symbol for custom currencies.
 */
export function buildGroupContextSection(
  group: GroupContext | undefined,
): string {
  if (!group) return ''
  const currencyLabel = group.currencyCode ?? group.currency
  return `Group context: This group is named "${group.name}" and uses ${currencyLabel} as its currency.`
}

/**
 * Past-expense examples section. Empty string when there are no
 * examples. Repetition is intentional and reflects the raw frequency of
 * each title in the group's history.
 */
export function buildRecentExpensesSection(expenses: RecentExpense[]): string {
  if (expenses.length === 0) return ''
  const pairs = expenses
    .map((e) => `"${e.title}" -> ${e.categoryId}`)
    .join(', ')
  return `Past expenses in this group (title -> category ID): ${pairs}. Use these as examples of how this group categorizes expenses.`
}
