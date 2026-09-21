import type { CategoryLocalThresholds } from '@spliit/domain'

export type RuntimeFeatureFlags = {
  enableExpenseDocuments: boolean
  enableReceiptExtract: boolean
  enableVoiceExpense: boolean
  enableCategoryExtract: boolean
  enableBulkCategorize: boolean
  /**
   * Local suggest stages (deployment switches, no per-user opt-out: they are
   * deterministic and privacy-preserving). Mirrored on the server so both
   * layers agree on which stages run.
   */
  enableDictionarySuggest: boolean
  enableHistorySuggest: boolean
  /** Active single-expense AI engine (informational; the server routes). */
  categoryEngine: 'llm' | 'system-one'
  /** Local-matcher gates, resolved from server env. */
  categoryLocalThresholds: CategoryLocalThresholds
  /** Active AI confidence floor (informational; enforced server-side). */
  aiMinConfidence: number
}
