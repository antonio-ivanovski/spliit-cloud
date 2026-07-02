import type {
  ExpenseActivityData,
  ExpenseChangedField,
  GroupActivityData,
  GroupChangedField,
  InvitationActivityData,
  InvitationType,
  MemberActivityData,
  GroupRole,
} from '@spliit/domain/activities'

type BuildExpenseInput = {
  summary?: string
  title?: string
  amount?: number
  currencyCode?: string | null
  date?: string
  changedFields?: ExpenseChangedField[]
  affectedParticipants?: string[]
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
    ...(input.affectedParticipants !== undefined
      ? { affectedParticipants: input.affectedParticipants }
      : {}),
  }
}

type BuildGroupInput = {
  summary?: string
  changedFields?: GroupChangedField[]
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
    ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
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
