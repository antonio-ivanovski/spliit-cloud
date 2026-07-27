import { z } from 'zod'
import {
  accountSummarySchema,
  groupInvitationStatusSchema,
  groupInvitationTypeSchema,
  groupRoleSchema,
  groupTypeSchema,
} from './common'

export const ledgerParticipantSchema = z.object({
  id: z.string(),
  ledgerId: z.string(),
  groupMemberId: z.string().nullable(),
  kind: z.enum(['ACCOUNT_MEMBER', 'UNLINKED_PARTICIPANT']),
  displayName: z.string().nullable(),
  removedAt: z.date().nullable(),
})

export const groupParticipantSchema = z.object({
  id: z.string(),
  name: z.string(),
  account: accountSummarySchema.nullable(),
  pending: z.boolean(),
  unlinked: z.boolean(),
})

const groupMemberSchema = z.object({
  id: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  groupId: z.string(),
  accountId: z.string(),
  role: groupRoleSchema,
  status: z.enum(['PENDING', 'ACTIVE', 'LEFT', 'REMOVED', 'SUSPENDED']),
  joinedAt: z.date().nullable(),
  leftAt: z.date().nullable(),
  account: accountSummarySchema,
  ledgerParticipant: ledgerParticipantSchema.nullable(),
})

const groupInvitationSchema = z.object({
  id: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  groupId: z.string(),
  type: groupInvitationTypeSchema,
  email: z.string(),
  temporaryName: z.string().nullable(),
  role: groupRoleSchema,
  status: groupInvitationStatusSchema,
  acceptedAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  ledgerParticipantId: z.string().nullable(),
})

export const groupLedgerSchema = z.object({
  id: z.string(),
  currency: z.string(),
  currencyCode: z.string().nullable(),
  createdAt: z.date(),
})

/** Full group DTO returned by groups.get and groups.getDetails. */
export const groupSchema = z.object({
  id: z.string(),
  name: z.string(),
  information: z.string().nullable(),
  archived: z.boolean(),
  createdAt: z.date(),
  groupType: groupTypeSchema,
  ledgerId: z.string(),
  friendPairKey: z.string().nullable(),
  ledger: groupLedgerSchema,
  members: z.array(groupMemberSchema),
  invitations: z.array(groupInvitationSchema),
  currency: z.string(),
  currencyCode: z.string().nullable(),
  participants: z.array(groupParticipantSchema),
})

/** Group list DTO. The list query deliberately returns a smaller ledger. */
export const groupListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  information: z.string().nullable(),
  archived: z.boolean(),
  createdAt: z.date(),
  groupType: groupTypeSchema,
  ledgerId: z.string(),
  friendPairKey: z.string().nullable(),
  ledger: z.object({
    currency: z.string(),
    currencyCode: z.string().nullable(),
  }),
  memberCount: z.number().int().nonnegative(),
})

export const getGroupOutputSchema = z.object({
  group: groupSchema,
  displayName: z.string(),
  currentLedgerParticipantId: z.string().nullable(),
  currentMember: z
    .object({
      id: z.string(),
      role: groupRoleSchema,
      status: z.enum(['PENDING', 'ACTIVE', 'LEFT', 'REMOVED', 'SUSPENDED']),
    })
    .nullable(),
  currentInvitation: z
    .object({
      id: z.string(),
      role: groupRoleSchema,
      type: groupInvitationTypeSchema,
    })
    .nullable(),
  linkInviteState: z
    .enum(['PENDING', 'ACCEPTED', 'REVOKED', 'DECLINED', 'EXPIRED'])
    .nullable(),
})

export const getGroupDetailsOutputSchema = z.object({
  group: groupSchema,
  participantsWithExpenses: z.array(z.string()),
  hasExpenses: z.boolean(),
})

export const listGroupsOutputSchema = z.object({
  groups: z.array(groupListItemSchema),
})

export const createGroupOutputSchema = z.object({
  groupId: z.string(),
})

export const deleteGroupOutputSchema = z.object({
  deleted: z.literal(true),
})

export const archiveGroupOutputSchema = z.object({
  group: z.object({
    id: z.string(),
    archived: z.boolean(),
  }),
})

export const leavePreviewOutputSchema = z.object({
  role: z.enum(['ADMIN', 'MEMBER']),
  isLastActiveMember: z.boolean(),
  isLastAdmin: z.boolean(),
  hasUnsettledBalance: z.boolean(),
  otherAdmins: z.array(z.object({ id: z.string(), name: z.string() })),
  promotableMembers: z.array(z.object({ id: z.string(), name: z.string() })),
})

export const leaveOutputSchema = z.object({
  promotedMemberId: z.string().nullable(),
})

export const archiveForSelfOutputSchema = z.object({
  archived: z.literal(true),
})
