import * as z from 'zod'

export const activityTypeSchema = z.enum([
  'EXPENSE_CREATED',
  'EXPENSE_UPDATED',
  'EXPENSE_DELETED',
  'GROUP_UPDATED',
  'GROUP_ARCHIVED',
  'GROUP_UNARCHIVED',
  'INVITATION_CREATED',
  'INVITATION_REVOKED',
  'INVITATION_ACCEPTED',
  'INVITATION_DECLINED',
  'MEMBER_LEFT',
  'MEMBER_REMOVED',
  'MEMBER_ROLE_CHANGED',
])

export type ActivityType = z.infer<typeof activityTypeSchema>

export const activityActorTypeSchema = z.enum([
  'ACCOUNT',
  'LEDGER_PARTICIPANT',
  'SYSTEM',
])

export type ActivityActorType = z.infer<typeof activityActorTypeSchema>

export const activitySubjectTypeSchema = z.enum([
  'EXPENSE',
  'GROUP',
  'MEMBER',
  'INVITATION',
  'LEDGER_PARTICIPANT',
])

export type ActivitySubjectType = z.infer<typeof activitySubjectTypeSchema>
