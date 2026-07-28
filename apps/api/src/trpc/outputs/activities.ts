import { z } from 'zod'

import {
  activityActorTypeSchema,
  activityDataSchema,
  activitySubjectTypeSchema,
  activityTypeSchema,
} from '@spliit/domain/activities'

const activityExpenseSchema = z.object({
  id: z.string(),
  title: z.string(),
  amount: z.number().int(),
  expenseDate: z.date(),
  categoryId: z.string(),
  splitMode: z.string(),
  paidBySplitMode: z.string(),
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
