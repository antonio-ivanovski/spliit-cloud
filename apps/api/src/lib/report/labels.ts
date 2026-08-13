import { z } from 'zod'

const short = (max: number) => z.string().min(1).max(max)

/**
 * Fixed schema for the already-localized report labels sent by the web app. The
 * API never embeds a translation catalog; the client resolves every string
 * through i18next and the category-name map from its own category localization.
 * Length limits are conservative so unbounded user input can never bloat the
 * report.
 */
export const reportLabelsSchema = z.object({
  // Document + header
  title: short(120),
  generatedOnLabel: short(80),
  // Period / balance-as-of disambiguation
  periodLabel: short(120),
  balanceAsOfLabel: short(120),
  // Summary line
  totalSpentLabel: short(80),
  expensesCountLabel: short(80),
  participantsCountLabel: short(80),
  // Sections
  participantsSectionLabel: short(120),
  settlementsSectionLabel: short(120),
  recordedSettlementsSectionLabel: short(120),
  expensesSectionLabel: short(120),
  // Table columns
  amountColumnLabel: short(80),
  participantColumnLabel: short(80),
  paidColumnLabel: short(80),
  shareColumnLabel: short(80),
  balanceColumnLabel: short(80),
  dateColumnLabel: short(80),
  fromColumnLabel: short(80),
  toColumnLabel: short(80),
  expenseColumnLabel: short(80),
  categoryColumnLabel: short(80),
  // Per-expense details line
  splitLabel: short(80),
  // Empty states
  noExpensesLabel: short(160),
  noParticipantsLabel: short(160),
  noSettlementsLabel: short(160),
  noRecordedSettlementsLabel: short(160),
  // Conversion note for cross-currency expenses
  originalAmountLabel: short(160),
  // Category id → localized category name
  categoryNames: z
    .record(z.string().min(1), z.string().min(1).max(80))
    .refine((record) => Object.keys(record).length <= 200, {
      message: 'Too many category names',
    }),
})

export type ReportLabels = z.output<typeof reportLabelsSchema>
