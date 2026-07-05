import { GroupInvitationStatus, GroupMemberStatus, prisma } from '@spliit/db'
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
      // `archived` in the API response is the per-account "hide" preference
      // — the underlying column is named `archived` for migration simplicity
      // (see the schema comment on `AccountGroupPreference`).
      const prefRecords = await prisma.accountGroupPreference.findMany({
        where: {
          accountId: ctx.auth.user.id,
          groupId: { in: groupIds },
        },
        select: {
          groupId: true,
          starred: true,
          archived: true,
          pinned: true,
          hidden: true,
        },
      })
      const prefByGroupId = new Map(
        prefRecords.map((p) => [
          p.groupId,
          {
            starred: p.starred,
            // The API exposes the per-account "hide" preference under
            // `preference.hidden`. The DB column is still `archived` — we
            // keep the rename at the boundary so callers see "hide" and the
            // "archived" label is reserved for the group-level flag.
            hidden: p.archived,
            pinned: p.pinned,
          },
        ]),
      )
      const defaultPref = {
        starred: false,
        hidden: false,
        pinned: false,
      }

      const entries = memberships.map((m) => ({
        ...m.group,
        createdAt: m.group.createdAt.toISOString(),
        // The caller's role on this group. The web client uses it to gate
        // the group-level archive action (ADMIN only).
        currentMemberRole: m.role,
        preference: prefByGroupId.get(m.groupId) ?? defaultPref,
      }))

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

  // Server-backed preferences for a single group. The API response uses
  // `hidden` for the per-account "hide" preference (the underlying column
  // is `AccountGroupPreference.archived`).
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
              hidden: pref.archived,
              pinned: pref.pinned,
            }
          : { starred: false, hidden: false, pinned: false },
      }
    }),

  setPreference: protectedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        starred: z.boolean().optional(),
        hidden: z.boolean().optional(),
        pinned: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input: { groupId, hidden, ...prefs }, ctx }) => {
      // `hidden` (per-account "hide") maps to the `archived` column.
      const data: {
        starred?: boolean
        archived?: boolean
        pinned?: boolean
      } = { ...prefs }
      if (hidden !== undefined) data.archived = hidden
      const preference = await prisma.accountGroupPreference.upsert({
        where: {
          accountId_groupId: { accountId: ctx.auth.user.id, groupId },
        },
        create: {
          id: randomId(),
          accountId: ctx.auth.user.id,
          groupId,
          ...data,
        },
        update: data,
      })
      return {
        preferences: {
          starred: preference.starred,
          hidden: preference.archived,
          pinned: preference.pinned,
        },
      }
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

  // Contacts: accounts the current user has shared groups with,
  // ordered by number of shared groups descending. Excludes accounts
  // whose only email is a synthetic placeholder (cannot be invited
  // via email). When `groupId` is provided, each contact also carries
  // an `isMember` flag for "already a member" marking in the UI.
  contacts: protectedProcedure
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
        return { contacts: [] }
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

      const contacts = coMembers
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
          }
        })
        .filter((c): c is NonNullable<typeof c> => c !== null)

      return { contacts }
    }),
})
