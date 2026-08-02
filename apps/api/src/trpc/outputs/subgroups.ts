import { z } from 'zod'

export const subgroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  participantIds: z.array(z.string()),
})

export const listSubgroupsOutputSchema = z.object({
  enabled: z.boolean(),
  subgroups: z.array(subgroupSchema),
})

export const subgroupMutationOutputSchema = z.object({
  subgroup: subgroupSchema,
})

export const subgroupEnabledOutputSchema = z.object({
  enabled: z.boolean(),
})

export const subgroupDeletedOutputSchema = z.object({
  deleted: z.literal(true),
})
