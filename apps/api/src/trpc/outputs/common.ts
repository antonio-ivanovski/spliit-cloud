import { z } from 'zod'

export const accountSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string().nullable(),
})

export const accountContactSchema = accountSummarySchema.extend({
  email: z.string(),
})

export const accountProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  isAnonymous: z.boolean().default(false),
  image: z.string().nullable(),
})

export const groupRoleSchema = z.enum(['ADMIN', 'MEMBER'])
export const groupTypeSchema = z.enum(['GROUP', 'FRIEND'])

export const groupInvitationStatusSchema = z.enum([
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'REVOKED',
])

export const groupInvitationTypeSchema = z.enum(['EMAIL', 'LINK'])

export const emptyOutputSchema = z.object({})
