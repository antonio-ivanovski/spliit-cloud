import { z } from 'zod'

export const savedViewSchema = z.object({
  groupId: z.string(),
  viewKey: z.string(),
  lastOpenedAt: z.string(),
})

export const saveSavedViewInputSchema = z.object({
  groupId: z.string().min(1),
  viewKey: z.string().min(1).max(200),
})

export const touchSavedViewInputSchema = saveSavedViewInputSchema

export const removeSavedViewInputSchema = z.object({
  groupId: z.string().min(1),
})

export const MERGE_SAVED_VIEWS_MAX_ITEMS = 100

export const mergeSavedViewsInputSchema = z.object({
  items: z
    .array(
      z.object({
        groupId: z.string().min(1),
        viewKey: z.string().min(1).max(200),
        lastOpenedAt: z.string().optional(),
      }),
    )
    .max(MERGE_SAVED_VIEWS_MAX_ITEMS),
})

export const saveSavedViewOutputSchema = savedViewSchema
export const touchSavedViewOutputSchema = savedViewSchema.nullable()
export const removeSavedViewOutputSchema = z.object({
  removed: z.literal(true),
})
export const mergeSavedViewsOutputSchema = z.object({
  saved: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  completedGroupIds: z.array(z.string()),
})
