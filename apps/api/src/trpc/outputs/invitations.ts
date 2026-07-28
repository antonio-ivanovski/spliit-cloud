import { z } from 'zod'

import {
  groupInvitationStatusSchema,
  groupInvitationTypeSchema,
  groupRoleSchema,
} from './common'

export const invitationSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  type: groupInvitationTypeSchema.default('EMAIL'),
  email: z.string(),
  temporaryName: z.string().nullable().default(null),
  role: groupRoleSchema,
  status: groupInvitationStatusSchema,
  createdAt: z.date(),
  expiresAt: z.date().nullable().default(null),
  ledgerParticipantId: z.string().nullable().default(null),
})

export const accountInvitationSchema = invitationSchema.extend({
  group: z.object({
    id: z.string(),
    name: z.string(),
  }),
  invitedBy: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
  }),
})

export const invitationsListOutputSchema = z.object({
  invitations: z.array(invitationSchema),
})

export const accountInvitationsListOutputSchema = z.object({
  invitations: z.array(accountInvitationSchema),
})

export const linkInvitationPreviewSchema = z.object({
  group: z.object({
    id: z.string(),
    name: z.string(),
  }),
  inviter: z.object({
    name: z.string(),
  }),
  temporaryName: z.string().nullable(),
  role: groupRoleSchema,
  usable: z.boolean(),
  reason: z
    .enum(['revoked', 'declined', 'accepted', 'expired', 'unknown'])
    .nullable(),
  expiresAt: z.date().nullable(),
})

export const revokeInvitationPreviewSchema = z.object({
  invitationEmail: z.string(),
  invitationLabel: z.string(),
  hasUnsettledBalance: z.boolean(),
})

export const createLinkInvitationOutputSchema = z.object({
  invitationId: z.string(),
  inviteUrl: z.string().url(),
  expiresAt: z.date(),
  temporaryName: z.string().nullable(),
  role: groupRoleSchema,
})
