import { z } from 'zod'

import { splitPresetSchema, splitPresetTargetSchema } from '@spliit/domain'

const splitPresetRecordSchema = splitPresetSchema.extend({
  id: z.string(),
  name: z.string(),
  scope: z.enum(['SHARED', 'PERSONAL']),
  ownerAccountId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

const defaultChoiceSchema = z.object({
  mode: z.enum(['INHERIT', 'PRESET', 'NEUTRAL']),
  presetId: z.string().nullable(),
})

const defaultsSchema = z.object({
  paidByPresetId: z.string().nullable(),
  paidForPresetId: z.string().nullable(),
})

export const splitPresetListOutputSchema = z.object({
  presets: z.array(splitPresetRecordSchema),
  canManageShared: z.boolean(),
  canManagePersonal: z.boolean(),
  groupDefaults: defaultsSchema,
  personalDefaults: z.object({
    paidBy: defaultChoiceSchema,
    paidFor: defaultChoiceSchema,
  }),
  effectiveDefaults: defaultsSchema,
})

export const splitPresetMutationOutputSchema = z.object({
  preset: splitPresetRecordSchema,
})

export const splitPresetDeleteOutputSchema = z.object({
  deleted: z.literal(true),
})

export const splitPresetDefaultsOutputSchema = z.object({
  groupDefaults: defaultsSchema,
  personalDefaults: z.object({
    paidBy: defaultChoiceSchema,
    paidFor: defaultChoiceSchema,
  }),
  effectiveDefaults: defaultsSchema,
})

export { splitPresetTargetSchema }
