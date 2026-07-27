import type {
  ExpenseActivityChange,
  ExpenseActivityData,
  ExpenseChangedField,
  ExpenseCommentActivityData,
  GroupActivityChange,
  GroupActivityData,
  GroupChangedField,
  GroupRole,
  ImportSummaryActivityData,
  InvitationActivityData,
  InvitationType,
  MemberActivityData,
  RecurrenceActivityMetadata,
} from '@spliit/domain/activities'

type BuildExpenseInput = {
  summary?: string
  title?: string
  amount?: number
  currencyCode?: string | null
  date?: string
  changedFields?: ExpenseChangedField[]
  changes?: ExpenseActivityChange[]
  affectedParticipants?: string[]
  originalAmount?: number
  conversionRate?: number
  conversionSource?: 'EXCHANGE' | 'CUSTOM' | null
  ledgerCurrencyCode?: string | null
  recurrence?: RecurrenceActivityMetadata
  stopped?: boolean
}

export function buildExpenseActivityData(
  input: BuildExpenseInput,
): ExpenseActivityData {
  return {
    kind: 'expense',
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.amount !== undefined ? { amount: input.amount } : {}),
    ...(input.currencyCode !== undefined
      ? { currencyCode: input.currencyCode }
      : {}),
    ...(input.date !== undefined ? { date: input.date } : {}),
    ...(input.changedFields !== undefined
      ? { changedFields: input.changedFields }
      : {}),
    ...(input.changes !== undefined ? { changes: input.changes } : {}),
    ...(input.affectedParticipants !== undefined
      ? { affectedParticipants: input.affectedParticipants }
      : {}),
    ...(input.originalAmount !== undefined
      ? { originalAmount: input.originalAmount }
      : {}),
    ...(input.conversionRate !== undefined
      ? { conversionRate: input.conversionRate }
      : {}),
    ...(input.conversionSource !== undefined && input.conversionSource !== null
      ? { conversionSource: input.conversionSource }
      : {}),
    ...(input.ledgerCurrencyCode !== undefined
      ? { ledgerCurrencyCode: input.ledgerCurrencyCode }
      : {}),
    ...(input.recurrence !== undefined ? { recurrence: input.recurrence } : {}),
    ...(input.stopped !== undefined ? { stopped: input.stopped } : {}),
  }
}

export function buildExpenseCommentActivityData(input: {
  commentId: string
  expenseTitle: string
  authorName: string
  excerpt: string
}): ExpenseCommentActivityData {
  return {
    kind: 'expense_comment',
    commentId: input.commentId,
    expenseTitle: input.expenseTitle,
    authorName: input.authorName,
    excerpt: input.excerpt.slice(0, 160),
  }
}

type BuildGroupInput = {
  summary?: string
  changedFields?: GroupChangedField[]
  changes?: GroupActivityChange[]
}

export function buildGroupActivityData(
  input: BuildGroupInput,
): GroupActivityData {
  return {
    kind: 'group',
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
    ...(input.changedFields !== undefined
      ? { changedFields: input.changedFields }
      : {}),
    ...(input.changes !== undefined ? { changes: input.changes } : {}),
  }
}

type BuildMemberInput = {
  summary?: string
  displayName?: string
  previousRole?: GroupRole
  nextRole?: GroupRole
  targetDisplayName?: string
}

export function buildMemberActivityData(
  input: BuildMemberInput,
): MemberActivityData {
  return {
    kind: 'member',
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
    ...(input.displayName !== undefined
      ? { displayName: input.displayName }
      : {}),
    ...(input.previousRole !== undefined
      ? { previousRole: input.previousRole }
      : {}),
    ...(input.nextRole !== undefined ? { nextRole: input.nextRole } : {}),
    ...(input.targetDisplayName !== undefined
      ? { targetDisplayName: input.targetDisplayName }
      : {}),
  }
}

type BuildInvitationInput = {
  summary?: string
  displayLabel?: string
  invitationType?: InvitationType
  role?: GroupRole
}

export function buildInvitationActivityData(
  input: BuildInvitationInput,
): InvitationActivityData {
  return {
    kind: 'invitation',
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
    ...(input.displayLabel !== undefined
      ? { displayLabel: input.displayLabel }
      : {}),
    ...(input.invitationType !== undefined
      ? { invitationType: input.invitationType }
      : {}),
    ...(input.role !== undefined ? { role: input.role } : {}),
  }
}

type BuildImportSummaryInput = {
  summary?: string
  count: number
  totalAmount?: number
  currencyCode?: string | null
  sourceProvider?: string
  affectedParticipants?: string[]
}

export function buildImportSummaryActivityData(
  input: BuildImportSummaryInput,
): ImportSummaryActivityData {
  return {
    kind: 'import_summary',
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
    count: input.count,
    ...(input.totalAmount !== undefined
      ? { totalAmount: input.totalAmount }
      : {}),
    ...(input.currencyCode !== undefined
      ? { currencyCode: input.currencyCode }
      : {}),
    ...(input.sourceProvider !== undefined
      ? { sourceProvider: input.sourceProvider }
      : {}),
    ...(input.affectedParticipants !== undefined
      ? { affectedParticipants: input.affectedParticipants }
      : {}),
  }
}
