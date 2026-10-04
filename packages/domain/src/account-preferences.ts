import { z } from 'zod'

import { supportedCurrencyCodes, type SupportedCurrencyCode } from './currency'
import { locales, type Locale } from './i18n'
import { timeZoneSchema } from './timezones'

export const accountThemeValues = ['light', 'dark', 'system'] as const
export const accountThemeSchema = z.enum(accountThemeValues)
export type AccountTheme = z.infer<typeof accountThemeSchema>

export const accountMascotValues = ['off', 'bill'] as const
export const accountMascotSchema = z.enum(accountMascotValues)
export type AccountMascot = z.infer<typeof accountMascotSchema>

/**
 * Delete-confirmation strictness. `strict` preserves the historical behaviour:
 * every destructive dialog requires typing the target name. `standard` keeps
 * typing only for critical, hard-to-recover deletes (group, participant) while
 * expense deletes become a simple confirm.
 */
export const destructiveConfirmationLevelValues = [
  'standard',
  'strict',
] as const
export const destructiveConfirmationLevelSchema = z.enum(
  destructiveConfirmationLevelValues,
)
export type DestructiveConfirmationLevel = z.infer<
  typeof destructiveConfirmationLevelSchema
>

export const DEFAULT_DESTRUCTIVE_CONFIRMATION_LEVEL: DestructiveConfirmationLevel =
  'strict'

export const destructiveConfirmationKindValues = [
  'deleteGroup',
  'deleteExpense',
  'deleteRecurringExpense',
  'removeParticipant',
] as const
export const destructiveConfirmationKindSchema = z.enum(
  destructiveConfirmationKindValues,
)
export type DestructiveConfirmationKind = z.infer<
  typeof destructiveConfirmationKindSchema
>

/**
 * Normalize a stored or cached level: `null`/`undefined` (including shapes that
 * pre-date the field) means the historical `strict` behaviour.
 */
export function resolveDestructiveConfirmationLevel(
  input: unknown,
): DestructiveConfirmationLevel {
  return input === 'standard' ? 'standard' : 'strict'
}

/**
 * Whether `kind` requires typing the target name at `level`. Group and
 * participant deletes are always typed; expense deletes are typed only in
 * `strict` mode.
 */
export function requiresTypedConfirmation(
  level: DestructiveConfirmationLevel | null | undefined,
  kind: DestructiveConfirmationKind,
): boolean {
  if (kind === 'deleteGroup' || kind === 'removeParticipant') return true
  return (level ?? DEFAULT_DESTRUCTIVE_CONFIRMATION_LEVEL) === 'strict'
}

/**
 * Group tab identifiers that can appear in an account's tab order. The order of
 * `groupTabIdValues` is the default tab order: Expenses, Balances, Activity,
 * Members, Stats, Budgets, Tools, Settings (`edit`).
 */
export const groupTabIdValues = [
  'expenses',
  'balances',
  'activity',
  'members',
  'stats',
  'budgets',
  'tools',
  'edit',
] as const
export const groupTabIdSchema = z.enum(groupTabIdValues)
export type GroupTabId = z.infer<typeof groupTabIdSchema>

/** Default group tab order used when an account has no custom order stored. */
export const defaultGroupTabOrder: readonly GroupTabId[] = groupTabIdValues

/**
 * Tab ids the account may hide. Expenses stays as the canonical landing tab and
 * Settings (`edit`) stays as the member-accessible home for export, so neither
 * can be hidden.
 */
export const hideableGroupTabIdValues = [
  'balances',
  'activity',
  'members',
  'stats',
  'budgets',
  'tools',
] as const
export const hideableGroupTabIdSchema = z.enum(hideableGroupTabIdValues)
export type HideableGroupTabId = z.infer<typeof hideableGroupTabIdSchema>

const groupTabIdSet = new Set<string>(groupTabIdValues)

/**
 * Merge a stored tab order with the default: unknown ids are dropped,
 * duplicates keep their first position, and tabs missing from the stored value
 * are appended in default order. `null`/`undefined`/empty resolves to the
 * default order.
 */
export function resolveGroupTabOrder(
  input: readonly string[] | null | undefined,
): GroupTabId[] {
  const seen = new Set<GroupTabId>()
  const ordered: GroupTabId[] = []
  for (const id of input ?? []) {
    if (groupTabIdSet.has(id) && !seen.has(id as GroupTabId)) {
      seen.add(id as GroupTabId)
      ordered.push(id as GroupTabId)
    }
  }
  for (const id of defaultGroupTabOrder) {
    if (!seen.has(id)) ordered.push(id)
  }
  return ordered
}

const supportedCurrencyCodeSet = new Set<string>(supportedCurrencyCodes)
const localeSet = new Set<string>(locales)

export const supportedCurrencyCodeSchema = z
  .string()
  .refine(
    (code): code is SupportedCurrencyCode => supportedCurrencyCodeSet.has(code),
    'unsupportedCurrencyCode',
  )

export const accountLocaleSchema = z
  .string()
  .refine(
    (locale): locale is Locale => localeSet.has(locale),
    'unsupportedLocale',
  )

/**
 * Complete persisted account-preference value shape. Nullable scalar fields
 * distinguish an unset preference from an explicit supported value.
 *
 * AI capability toggles (`ai*Enabled`) and the notifications master toggle
 * (`notificationsEnabled`) follow the same nullable convention: a missing or
 * `null` value means "use the default-on behaviour" and is normalized to `true`
 * at the API boundary (`apps/api/.../routers/account`). The `.nullish()`
 * modifier lets older stored shapes that pre-date these fields continue to
 * validate cleanly.
 *
 * `groupTabOrder` follows the same convention: `null`, `undefined`, or an empty
 * array means "use `defaultGroupTabOrder`". Use `resolveGroupTabOrder` to merge
 * a stored value with the default (unknown ids dropped, duplicates removed,
 * missing tabs appended in default order).
 *
 * `hiddenGroupTabs` follows the same convention: `null`, `undefined`, or an
 * empty array means "hide nothing". Only `hideableGroupTabIdValues` take
 * effect; Expenses and Settings can never be hidden.
 *
 * `destructiveConfirmationLevel` follows the same convention: a missing or
 * `null` value means the historical `strict` behaviour and is normalized to
 * `'strict'` at the API boundary. Use `resolveDestructiveConfirmationLevel` to
 * normalize and `requiresTypedConfirmation` to decide whether a dialog needs
 * typing.
 */
export const accountPreferenceSchema = z.object({
  defaultCurrencyCode: supportedCurrencyCodeSchema.nullable(),
  timeZone: timeZoneSchema.nullable(),
  locale: accountLocaleSchema.nullable(),
  theme: accountThemeSchema.nullable(),
  // Bill is on by default. Older exports do not contain this field; API and
  // client boundaries normalize a missing value to bill.
  mascot: accountMascotSchema.optional(),
  notificationsEnabled: z.boolean().nullish(),
  aiFeaturesEnabled: z.boolean().nullish(),
  aiCategoryExtractEnabled: z.boolean().nullish(),
  aiReceiptScanEnabled: z.boolean().nullish(),
  aiVoiceExpenseEnabled: z.boolean().nullish(),
  groupTabOrder: z.array(groupTabIdSchema).nullish(),
  hiddenGroupTabs: z.array(hideableGroupTabIdSchema).nullish(),
  destructiveConfirmationLevel: destructiveConfirmationLevelSchema.nullish(),
})

export type AccountPreference = z.infer<typeof accountPreferenceSchema>
