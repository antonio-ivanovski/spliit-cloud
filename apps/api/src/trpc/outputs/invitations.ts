import { z } from 'zod'

import {
  groupInvitationStatusSchema,
  groupInvitationTypeSchema,
  groupRoleSchema,
} from './common'

export const recipientProfileSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  image: z.string().nullable(),
})

export const invitationSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  type: groupInvitationTypeSchema.default('EMAIL'),
  email: z.string(),
  temporaryName: z.string().nullable().default(null),
  role: groupRoleSchema,
  status: groupInvitationStatusSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
  expiresAt: z.date().nullable().default(null),
  ledgerParticipantId: z.string().nullable().default(null),
  canRevoke: z.boolean().default(false),
  canManage: z.boolean().default(false),
  // Profile of the account matching the invitation email, when one exists.
  recipientProfile: recipientProfileSchema.nullable().default(null),
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
  inviteUrl: z.url(),
  expiresAt: z.date(),
  temporaryName: z.string().nullable(),
  role: groupRoleSchema,
})

export const updatePendingInvitationOutputSchema = z.object({
  invitation: invitationSchema,
  // One-time shareable URL for `EMAIL -> LINK` conversions. Null for
  // email/metadata-only saves.
  inviteUrl: z.url().nullable(),
})

export const regenerateLinkInvitationOutputSchema = z.object({
  invitation: invitationSchema,
  inviteUrl: z.url(),
})
