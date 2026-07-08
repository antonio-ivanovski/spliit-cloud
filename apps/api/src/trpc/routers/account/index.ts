import {
  GroupInvitationStatus,
  GroupInvitationType,
  GroupMemberStatus,
  GroupType,
  prisma,
} from '@spliit/db'
import { defaultSplitSchema } from '@spliit/domain'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { randomId } from '../../../lib/api'
import { isPlaceholderEmail } from '../../../lib/invitations'
import { createTRPCRouter, protectedProcedure } from '../../init'

/**
 * Account-scoped router. Used by the web client to bootstrap an authenticated
 * session (profile, group memberships, pending invitations) without exposing
 * legacy anonymous behaviour.
 */
export const accountRouter = createTRPCRouter({
  // Current account profile.
  me: protectedProcedure.query(async ({ ctx }) => {
    return { account: ctx.auth.user }
  }),

  // Update the current account's display name. Used by the
  // `complete-profile` flow that runs after a magic-link sign-up (or any
  // other first-time sign-in) when the account has no display name yet.
  updateProfile: protectedProcedure
    .input(
      z.object({
        name: z
          .string()
          .trim()
          .min(2, { error: 'nameTooShort' })
          .max(50, { error: 'max50' }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const account = await prisma.account.update({
        where: { id: ctx.auth.user.id },
        data: { name: input.name },
        select: { id: true, name: true, email: true, emailVerified: true },
      })
      return { account }
    }),

  // Account group memberships (active ones by default).
  groups: protectedProcedure
    .input(
      z
        .object({
          includeArchived: z.boolean().default(false),
        })
        .default({ includeArchived: false }),
    )
    .query(async ({ input: { includeArchived }, ctx }) => {
      const memberships = await prisma.groupMember.findMany({
        where: {
          accountId: ctx.auth.user.id,
          status: GroupMemberStatus.ACTIVE,
        },
        include: {
          group: {
            include: {
              ledger: { select: { currency: true, currencyCode: true } },
              _count: { select: { members: true } },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }],
      })

      const groupIds = memberships.map((m) => m.groupId)
      const prefRecords = await prisma.accountGroupPreference.findMany({
        where: {
          accountId: ctx.auth.user.id,
          groupId: { in: groupIds },
        },
        select: {
          groupId: true,
          starred: true,
          hidden: true,
        },
      })
      const prefByGroupId = new Map(
        prefRecords.map((p) => [
          p.groupId,
          {
            starred: p.starred,
            hidden: p.hidden,
          },
        ]),
      )
      const defaultPref = {
        starred: false,
        hidden: false,
      }

      const friendGroupIds = memberships
        .filter((m) => m.group.groupType === GroupType.FRIEND)
        .map((m) => m.groupId)
      const friendMemberByGroupId = new Map<
        string,
        { name: string; id: string } | null
      >()
      const friendPendingByGroupId = new Map<
        string,
        { name: string | null; email: string } | null
      >()
      if (friendGroupIds.length > 0) {
        const friendMembers = await prisma.groupMember.findMany({
          where: {
            groupId: { in: friendGroupIds },
            accountId: { not: ctx.auth.user.id },
            status: GroupMemberStatus.ACTIVE,
          },
          select: {
            groupId: true,
            account: { select: { id: true, name: true } },
          },
        })
        for (const m of friendMembers) {
          if (!friendMemberByGroupId.has(m.groupId)) {
            friendMemberByGroupId.set(m.groupId, {
              id: m.account.id,
              name: m.account.name,
            })
          }
        }
        const friendInvitations = await prisma.groupInvitation.findMany({
          where: {
            groupId: { in: friendGroupIds },
            status: GroupInvitationStatus.PENDING,
          },
          orderBy: { createdAt: 'desc' },
          select: {
            groupId: true,
            temporaryName: true,
            email: true,
          },
        })
        for (const inv of friendInvitations) {
          if (!friendPendingByGroupId.has(inv.groupId)) {
            friendPendingByGroupId.set(inv.groupId, {
              name: inv.temporaryName,
              email: inv.email,
            })
          }
        }
      }

      const entries = memberships.map((m) => {
        const isFriend = m.group.groupType === GroupType.FRIEND
        const pendingInv = friendPendingByGroupId.get(m.groupId)
        const displayName = isFriend
          ? friendMemberByGroupId.get(m.groupId)?.name ||
            pendingInv?.name ||
            (pendingInv?.email && !isPlaceholderEmail(pendingInv.email)
              ? pendingInv.email
              : undefined) ||
            ''
          : m.group.name
        return {
          ...m.group,
          createdAt: m.group.createdAt.toISOString(),
          // The caller's role on this group. The web client uses it to gate
          // the group-level archive action (ADMIN only).
          currentMemberRole: m.role,
          preference: prefByGroupId.get(m.groupId) ?? defaultPref,
          displayName,
        }
      })

      // Default view: only non-archived groups that the user has not hidden.
      // When `includeArchived` is true, also return group-archived groups
      // and groups the user has hidden (both surface under the same toggle
      // on the /groups page). The FE sorts/groups them into the right
      // sections.
      const visible = entries.filter((entry) => {
        if (entry.preference.hidden && !includeArchived) return false
        if (entry.archived && !includeArchived) return false
        return true
      })

      return { groups: visible }
    }),

  // Server-backed preferences for a single group. The response uses `hidden`
  // for the per-account "hide" preference, which lives on the same-named
  // `AccountGroupPreference.hidden` column.
  preferences: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .query(async ({ input: { groupId }, ctx }) => {
      const pref = await prisma.accountGroupPreference.findUnique({
        where: {
          accountId_groupId: { accountId: ctx.auth.user.id, groupId },
        },
      })
      return {
        preferences: pref
          ? {
              starred: pref.starred,
              hidden: pref.hidden,
            }
          : { starred: false, hidden: false },
      }
    }),

  setPreference: protectedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        starred: z.boolean().optional(),
        hidden: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const data: { starred?: boolean; hidden?: boolean } = {}
      if (input.starred !== undefined) data.starred = input.starred
      if (input.hidden !== undefined) data.hidden = input.hidden
      const preference = await prisma.accountGroupPreference.upsert({
        where: {
          accountId_groupId: {
            accountId: ctx.auth.user.id,
            groupId: input.groupId,
          },
        },
        create: {
          id: randomId(),
          accountId: ctx.auth.user.id,
          groupId: input.groupId,
          ...data,
        },
        update: data,
      })
      return {
        preferences: {
          starred: preference.starred,
          hidden: preference.hidden,
        },
      }
    }),

  // Per-user, per-group saved default split. Null means "no default".
  // ITEMIZED is not allowed: itemized expenses carry an `items` array
  // whose shape is too heavy to be a useful "default", and the UI hides
  // the save action when the current split is itemized.
  defaultSplit: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .query(async ({ input: { groupId }, ctx }) => {
      const row = await prisma.accountGroupDefaultSplit.findUnique({
        where: {
          accountId_groupId: { accountId: ctx.auth.user.id, groupId },
        },
        include: { paidFor: true },
      })
      if (!row) return { defaultSplit: null }
      return {
        defaultSplit: {
          splitMode: row.splitMode,
          paidFor: row.paidFor.map(({ participantId, shares }) => ({
            participant: participantId,
            shares,
          })),
        },
      }
    }),

  setDefaultSplit: protectedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        defaultSplit: defaultSplitSchema,
      }),
    )
    .mutation(async ({ input: { groupId, defaultSplit }, ctx }) => {
      // ITEMIZED is excluded by `defaultSplitSchema` at the zod level so
      // it cannot reach this resolver — the runtime check is intentionally
      // omitted here. See the schema comment for the rationale.

      // Membership check: the user must be an active member of the group
      // before they can write to its per-group preferences.
      const member = await prisma.groupMember.findUnique({
        where: {
          groupId_accountId: { groupId, accountId: ctx.auth.user.id },
        },
        select: { status: true },
      })
      if (!member || member.status !== GroupMemberStatus.ACTIVE) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You are not an active member of this group',
        })
      }

      // Validate that every participant in the default split belongs to
      // the group's current ledger. Stale participant ids (e.g. someone
      // removed from the group since the default was saved) are rejected
      // so the UI never sees a default that no longer makes sense. The
      // database FK on `AccountGroupDefaultSplitPaidFor.participantId`
      // also enforces this at write time; the explicit check here gives
      // a clearer `BAD_REQUEST` error than a Prisma constraint failure.
      const ledgerParticipants = await prisma.ledgerParticipant.findMany({
        where: { ledger: { group: { id: groupId } } },
        select: { id: true },
      })
      const validIds = new Set(ledgerParticipants.map((p) => p.id))
      for (const row of defaultSplit.paidFor) {
        if (!validIds.has(row.participant)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Default split references an unknown participant',
          })
        }
      }

      // Upsert the header row + replace its paidFor children in a single
      // transaction. We delete-and-recreate the children rather than
      // trying to diff them — the row count is small (≤ group size) and
      // this keeps the upsert logic trivially correct.
      await prisma.$transaction(async (tx) => {
        const header = await tx.accountGroupDefaultSplit.upsert({
          where: {
            accountId_groupId: { accountId: ctx.auth.user.id, groupId },
          },
          create: {
            id: randomId(),
            accountId: ctx.auth.user.id,
            groupId,
            splitMode: defaultSplit.splitMode,
          },
          update: {
            splitMode: defaultSplit.splitMode,
            updatedAt: new Date(),
          },
        })
        await tx.accountGroupDefaultSplitPaidFor.deleteMany({
          where: { defaultSplitId: header.id },
        })
        await tx.accountGroupDefaultSplitPaidFor.createMany({
          data: defaultSplit.paidFor.map(({ participant, shares }) => ({
            defaultSplitId: header.id,
            participantId: participant,
            shares,
          })),
        })
      })

      return { defaultSplit }
    }),

  // Members list for a group (active members). Used to render member
  // management UI.
  members: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .query(async ({ input: { groupId }, ctx }) => {
      // Authorise as a member of the group.
      const member = await prisma.groupMember.findUnique({
        where: {
          groupId_accountId: { groupId, accountId: ctx.auth.user.id },
        },
      })
      if (!member || member.status !== GroupMemberStatus.ACTIVE) {
        return { members: [] }
      }
      const members = await prisma.groupMember.findMany({
        where: { groupId, status: GroupMemberStatus.ACTIVE },
        include: {
          account: { select: { id: true, name: true, email: true } },
          ledgerParticipant: { select: { id: true } },
        },
        orderBy: [{ joinedAt: 'asc' }, { createdAt: 'asc' }],
      })
      return { members }
    }),

  // Friends: accounts the current user has shared groups with,
  // ordered by number of shared groups descending. Excludes accounts
  // whose only email is a synthetic placeholder (cannot be invited
  // via email). When `groupId` is provided, each friend also carries
  // an `isMember` flag for "already a member" marking in the UI.
  friends: protectedProcedure
    .input(
      z
        .object({
          groupId: z.string().min(1).optional(),
        })
        .default({}),
    )
    .query(async ({ input: { groupId }, ctx }) => {
      const currentId = ctx.auth.user.id

      // All groups the current account has ever joined (excludes
      // PENDING invitations that never materialised).
      const myMemberships = await prisma.groupMember.findMany({
        where: {
          accountId: currentId,
          status: {
            in: [
              GroupMemberStatus.ACTIVE,
              GroupMemberStatus.LEFT,
              GroupMemberStatus.REMOVED,
            ],
          },
        },
        select: { groupId: true },
      })
      const myGroupIds = myMemberships.map((m) => m.groupId)

      if (myGroupIds.length === 0) {
        return { friends: [] }
      }

      // Other accounts that have also joined those groups.
      const coMembers = await prisma.groupMember.groupBy({
        by: ['accountId'],
        where: {
          groupId: { in: myGroupIds },
          accountId: { not: currentId },
          status: {
            in: [
              GroupMemberStatus.ACTIVE,
              GroupMemberStatus.LEFT,
              GroupMemberStatus.REMOVED,
            ],
          },
        },
        _count: { groupId: true },
        orderBy: { _count: { groupId: 'desc' } },
      })

      const accountIds = coMembers.map((c) => c.accountId)
      const accounts = await prisma.account.findMany({
        where: { id: { in: accountIds } },
        select: { id: true, name: true, email: true },
      })
      const accountMap = new Map(accounts.map((a) => [a.id, a]))

      // Already-member lookup (ACTIVE memberships in the target group).
      let memberAccountIds = new Set<string>()
      // Pending invitations for contacts in the target group.
      let pendingInviteEmails = new Set<string>()
      if (groupId) {
        const existingMembers = await prisma.groupMember.findMany({
          where: {
            groupId,
            accountId: { in: accountIds },
            status: GroupMemberStatus.ACTIVE,
          },
          select: { accountId: true },
        })
        memberAccountIds = new Set(existingMembers.map((m) => m.accountId))

        const contactEmails = accounts
          .filter((a) => !isPlaceholderEmail(a.email))
          .map((a) => a.email.toLowerCase())
        if (contactEmails.length > 0) {
          const pendingInvites = await prisma.groupInvitation.findMany({
            where: {
              groupId,
              status: GroupInvitationStatus.PENDING,
              email: { in: contactEmails, mode: 'insensitive' },
            },
            select: { email: true },
          })
          pendingInviteEmails = new Set(
            pendingInvites.map((i) => i.email.toLowerCase()),
          )
        }
      }

      // Friend-ledger lookup. A friend is considered "ledgered" if there
      // is either a FRIEND-typed group whose friendPairKey matches the
      // caller+friend pair, or a PENDING FRIEND email invitation from the
      // caller targeting the friend's email.
      const friendEmailPairs = accounts
        .filter((a) => !isPlaceholderEmail(a.email))
        .map((a) => {
          const key =
            currentId < a.id ? `${currentId}:${a.id}` : `${a.id}:${currentId}`
          return { accountId: a.id, pairKey: key, email: a.email.toLowerCase() }
        })
      const ledgeredByAccountId = new Map<string, boolean>()
      if (friendEmailPairs.length > 0) {
        const pairKeys = friendEmailPairs.map((p) => p.pairKey)
        const friendGroups = await prisma.group.findMany({
          where: {
            groupType: GroupType.FRIEND,
            friendPairKey: { in: pairKeys },
          },
          select: { friendPairKey: true },
        })
        const linkedPairKeys = new Set(
          friendGroups.map((g) => g.friendPairKey!).filter(Boolean),
        )
        for (const pair of friendEmailPairs) {
          if (linkedPairKeys.has(pair.pairKey)) {
            ledgeredByAccountId.set(pair.accountId, true)
          }
        }
        const pendingEmails = friendEmailPairs
          .filter((p) => !ledgeredByAccountId.has(p.accountId))
          .map((p) => p.email)
        if (pendingEmails.length > 0) {
          const pendingFriendInvites = await prisma.groupInvitation.findMany({
            where: {
              type: GroupInvitationType.EMAIL,
              status: GroupInvitationStatus.PENDING,
              invitedById: currentId,
              group: { groupType: GroupType.FRIEND },
              email: { in: pendingEmails, mode: 'insensitive' },
            },
            select: { email: true },
          })
          const pendingSet = new Set(
            pendingFriendInvites.map((i) => i.email.toLowerCase()),
          )
          for (const pair of friendEmailPairs) {
            if (pendingSet.has(pair.email)) {
              ledgeredByAccountId.set(pair.accountId, true)
            }
          }
        }
      }

      const friends = coMembers
        .map((c) => {
          const account = accountMap.get(c.accountId)
          if (!account || isPlaceholderEmail(account.email)) return null
          return {
            accountId: account.id,
            name: account.name,
            email: account.email,
            sharedGroupCount: c._count.groupId,
            isMember: memberAccountIds.has(account.id),
            isPendingInvite: pendingInviteEmails.has(
              account.email.toLowerCase(),
            ),
            hasFriendLedger: ledgeredByAccountId.has(account.id),
          }
        })
        .filter((c): c is NonNullable<typeof c> => c !== null)

      return { friends }
    }),
})
