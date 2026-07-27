import { defaultSplitSchema } from '@spliit/domain'
import { z } from 'zod'
import {
  accountContactSchema,
  accountProfileSchema,
  accountSummarySchema,
  groupRoleSchema,
  groupTypeSchema,
} from './common'

export { accountProfileSchema }

export const accountGroupPreferenceSchema = z.object({
  starred: z.boolean(),
  hidden: z.boolean(),
})

export const accountGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  information: z.string().nullable(),
  archived: z.boolean(),
  createdAt: z.string(),
  groupType: groupTypeSchema.default('GROUP'),
  ledger: z.object({
    currency: z.string(),
    currencyCode: z.string().nullable(),
  }),
  memberCount: z.number().int().nonnegative(),
  currentMemberRole: groupRoleSchema,
  preference: accountGroupPreferenceSchema,
  displayName: z.string(),
  friendAccount: accountSummarySchema.nullable(),
  memberAccounts: z.array(accountSummarySchema),
})

export const accountMemberSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  accountId: z.string(),
  role: z.enum(['ADMIN', 'MEMBER']),
  status: z.enum(['PENDING', 'ACTIVE', 'LEFT', 'REMOVED', 'SUSPENDED']),
  joinedAt: z.date().nullable(),
  leftAt: z.date().nullable(),
  account: accountContactSchema,
  ledgerParticipant: z.object({ id: z.string() }).nullable(),
})

export const accountDefaultSplitSchema = z.object({
  defaultSplit: defaultSplitSchema.nullable(),
})

export const accountPreferencesSchema = z.object({
  preferences: accountGroupPreferenceSchema,
})

export const accountGroupsOutputSchema = z.object({
  groups: z.array(accountGroupSchema),
})

export const accountMembersOutputSchema = z.object({
  members: z.array(accountMemberSchema),
})

export const accountFriendsOutputSchema = z.object({
  friends: z.array(
    z.object({
      accountId: z.string(),
      name: z.string(),
      email: z.string(),
      sharedGroupCount: z.number().int(),
      isMember: z.boolean(),
      isPendingInvite: z.boolean(),
      hasFriendLedger: z.boolean(),
      friendLedgerStatus: z.enum(['NONE', 'INVITED', 'ACTIVE']),
    }),
  ),
})
