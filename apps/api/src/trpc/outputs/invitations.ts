import { z } from 'zod'

import { InviteEndedReasons } from '../../lib/invitations/effects'
import {
  groupInvitationStatusSchema,
  groupInvitationTypeSchema,
  groupRoleSchema,
  groupTypeSchema,
} from './common'

export const recipientProfileSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  image: z.string().nullable(),
})

export const qrSessionJoinerSchema = z.object({
  accountId: z.string(),
  name: z.string().nullable(),
  image: z.string().nullable(),
  joinedAt: z.date(),
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
  // QR / nearby sessions: multi-use short-lived link invitations.
  isMultiUse: z.boolean().default(false),
  useCount: z.number().default(0),
  // Shared (general-purpose multi-person) links: per-link join cap
  // (`null` = unlimited) and an optional member-facing label. Present only
  // for shared links; one-time links and QR sessions leave the defaults.
  maxUses: z.number().int().positive().nullable().default(null),
  label: z.string().nullable().default(null),
  // Whether the invitation is a copyable shared link (raw token stored).
  // Never the token itself — use `getLinkUrl` to retrieve the URL.
  isShared: z.boolean().default(false),
  // Derived liveness: 'expired' | 'full' | null (still joinable). Only
  // meaningful for shared links and QR sessions.
  endedReason: z.enum(['expired', 'full']).nullable().default(null),
  // Accounts that joined via this QR session, oldest first (empty unless
  // multi-use). Resolved from INVITATION_ACCEPTED activities.
  recentJoiners: z.array(qrSessionJoinerSchema).default([]),
  canRevoke: z.boolean().default(false),
  canManage: z.boolean().default(false),
  // Any active member may copy a live shared link's URL via `getLinkUrl`.
  canCopyLink: z.boolean().default(false),
  // Profile of the account matching the invitation email, when one exists.
  recipientProfile: recipientProfileSchema.nullable().default(null),
})

export const accountInvitationSchema = invitationSchema.extend({
  group: z.object({
    id: z.string(),
    name: z.string(),
  }),
  // Null when the inviter's account was deleted (invitation history is
  // preserved with a nulled inviter relation).
  invitedBy: z
    .object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
    })
    .nullable(),
})

export const invitationsListOutputSchema = z.object({
  invitations: z.array(invitationSchema),
})

export const accountInvitationsListOutputSchema = z.object({
  invitations: z.array(accountInvitationSchema),
})

export const shareMemberSampleSchema = z.object({
  name: z.string().nullable(),
  image: z.string().nullable(),
})

export const linkInvitationPreviewSchema = z.object({
  group: z.object({
    id: z.string(),
    name: z.string(),
    groupType: groupTypeSchema.default('GROUP'),
    emoji: z.string().nullable().default(null),
    color: z.string().nullable().default(null),
    currencyCode: z.string().nullable().default(null),
  }),
  inviter: z.object({
    name: z.string(),
    image: z.string().nullable().default(null),
  }),
  temporaryName: z.string().nullable(),
  role: groupRoleSchema,
  usable: z.boolean(),
  reason: z.enum(InviteEndedReasons).nullable(),
  expiresAt: z.date().nullable(),
  isMultiUse: z.boolean().default(false),
  useCount: z.number().default(0),
  maxUses: z.number().int().positive().nullable().default(null),
  isShared: z.boolean().default(false),
  memberCount: z.number().int().nonnegative().default(0),
  memberSample: z.array(shareMemberSampleSchema).default([]),
})

export const viewSharePreviewSchema = z.object({
  group: z.object({
    id: z.string(),
    name: z.string(),
    emoji: z.string().nullable().default(null),
    color: z.string().nullable().default(null),
    currencyCode: z.string().nullable().default(null),
  }),
  memberCount: z.number().int().nonnegative().default(0),
  memberSample: z.array(shareMemberSampleSchema).default([]),
  usable: z.boolean(),
})

export const revokeInvitationPreviewSchema = z.object({
  invitationEmail: z.string(),
  invitationLabel: z.string(),
  hasUnsettledBalance: z.boolean(),
})

export const createLinkInvitationOutputSchema = z.object({
  invitationId: z.string(),
  inviteUrl: z.url(),
  // Null when a shared link never expires. One-time links and QR sessions
  // always carry a date.
  expiresAt: z.date().nullable(),
  temporaryName: z.string().nullable(),
  role: groupRoleSchema,
  isMultiUse: z.boolean().default(false),
  useCount: z.number().default(0),
  maxUses: z.number().int().positive().nullable().default(null),
  label: z.string().nullable().default(null),
  isShared: z.boolean().default(false),
})

export const updatePendingInvitationOutputSchema = z.object({
  invitation: invitationSchema,
  // One-time shareable URL for `EMAIL -> LINK` conversions. Null for
  // email/metadata-only saves.
  inviteUrl: z.url().nullable(),
  // True when the (re)send was delivered or no send was attempted; false
  // when a send was attempted but skipped (SMTP unconfigured) or failed.
  emailDelivered: z.boolean(),
})

export const regenerateLinkInvitationOutputSchema = z.object({
  invitation: invitationSchema,
  inviteUrl: z.url(),
})
