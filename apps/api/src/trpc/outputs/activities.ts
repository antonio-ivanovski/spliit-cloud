import { z } from 'zod'

import {
  activityActorTypeSchema,
  activityDataSchema,
  activitySubjectTypeSchema,
  activityTypeSchema,
} from '@spliit/domain/activities'

const activityExpenseShareSchema = z.object({
  ledgerParticipant: z.object({
    id: z.string(),
    account: z.object({ id: z.string() }).nullable(),
  }),
  shares: z.number().int(),
})

const activityExpenseSchema = z.object({
  id: z.string(),
  title: z.string(),
  amount: z.number().int(),
  expenseDate: z.date(),
  categoryId: z.string(),
  splitMode: z.string(),
  paidBySplitMode: z.string(),
  originalAmount: z.number().int().nullable(),
  originalCurrency: z.string().nullable(),
  conversionRate: z.number().nullable(),
  conversionSource: z.string().nullable(),
  paidByList: z.array(activityExpenseShareSchema),
  paidFor: z.array(activityExpenseShareSchema),
})

export const activityListItemSchema = z.object({
  id: z.string(),
  ledgerId: z.string(),
  time: z.date(),
  type: activityTypeSchema,
  actorType: activityActorTypeSchema.nullable(),
  actorId: z.string().nullable(),
  subjectType: activitySubjectTypeSchema.nullable(),
  subjectId: z.string().nullable(),
  data: activityDataSchema.nullable(),
  actorName: z.string().nullable(),
  expense: activityExpenseSchema.nullable(),
})

export const listActivitiesOutputSchema = z.object({
  activities: z.array(activityListItemSchema),
  hasMore: z.boolean(),
  nextCursor: z.number().int().nonnegative(),
})
