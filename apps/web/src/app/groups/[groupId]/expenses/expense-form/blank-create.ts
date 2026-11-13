import type { CreateExpenseSearch } from '@/router/schemas'

/**
 * Search params that only carry group access or post-save navigation state.
 * Every other non-empty param belongs to a targeted entry flow (copy,
 * settlement, AI/receipt/voice, share target, deep link prefill), so a
 * seemingly blank form may already carry user data.
 */
const nonPrefillSearchKeys = new Set<keyof CreateExpenseSearch>([
  'invitationAction',
  'invitation',
  'invite',
  'viewKey',
  'returnTo',
])

export type BlankCreateEntryArgs = {
  isCreate: boolean
  hasSourceExpense: boolean
  hasDraftExpense: boolean
  isCopy: boolean
  hasRestoredDraft: boolean
  searchParams: CreateExpenseSearch | undefined
}

/**
 * A genuinely blank create entry: a fresh create form, not a copy or import,
 * without a restored recovery draft, and without any prefill search params.
 * Only this entry gets the guided title → amount focus path; targeted flows
 * keep their existing focus and Enter behavior.
 */
export function isBlankCreateEntry({
  isCreate,
  hasSourceExpense,
  hasDraftExpense,
  isCopy,
  hasRestoredDraft,
  searchParams,
}: BlankCreateEntryArgs): boolean {
  if (
    !isCreate ||
    hasSourceExpense ||
    hasDraftExpense ||
    isCopy ||
    hasRestoredDraft
  ) {
    return false
  }

  return Object.entries(searchParams ?? {}).every(
    ([key, value]) =>
      value == null ||
      value === '' ||
      nonPrefillSearchKeys.has(key as keyof CreateExpenseSearch),
  )
}
