import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { prisma } from '@spliit/db'
import { DEFAULT_CATEGORIES } from '@spliit/domain'

import { getGroupBalances } from '../../lib/api/balances'
import { createExpense } from '../../lib/api/expenses/create-expense'
import { getGroupExpenses } from '../../lib/api/expenses/queries'
import {
  AssistantExpenseInputError,
  getAssistantGroup,
  openConfirmation,
  prepareAssistantExpense,
  prepareExpenseInputSchema,
} from '../../lib/assistant/expense'
import { assistantProcedure, createTRPCRouter } from '../init'

const readProcedure = assistantProcedure('spliit:groups:read')
const writeProcedure = assistantProcedure('spliit:expenses:write')

/**
 * Maximum number of groups returned in one `listGroups` response. Large
 * accounts are truncated and the model narrows them with `groupHint` instead of
 * receiving an unbounded, high-token payload.
 */
export const GROUP_RESPONSE_CAP = 50

/** One-pass case-folded frequency map, replacing repeated O(n) filters. */
function countByLower(values: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const value of values) {
    const key = value.toLocaleLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function displayGroupName(
  group: {
    name: string
    groupType: 'GROUP' | 'FRIEND'
    members: Array<{ accountId: string; account: { name: string } }>
  },
  accountId: string,
) {
  if (group.name) return group.name
  return (
    group.members.find((member) => member.accountId !== accountId)?.account
      .name ?? (group.groupType === 'FRIEND' ? 'Friend' : 'Untitled group')
  )
}

export const assistantRouter = createTRPCRouter({
  listGroups: readProcedure
    .input(
      z
        .object({
          groupHint: z
            .string()
            .trim()
            .min(1)
            .max(120)
            .optional()
            .describe(
              'Case-insensitive substring to narrow groups by name when an account has many',
            ),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const memberships = await prisma.groupMember.findMany({
        where: {
          accountId: ctx.auth.user.id,
          status: 'ACTIVE',
          group: {
            archived: false,
            accountPreferences: {
              none: { accountId: ctx.auth.user.id, hidden: true },
            },
          },
        },
        include: {
          group: {
            include: {
              ledger: {
                include: {
                  participants: {
                    where: {
                      removedAt: null,
                      OR: [
                        { groupMember: { status: 'ACTIVE' } },
                        { invitations: { some: { status: 'PENDING' } } },
                        { kind: 'UNLINKED_PARTICIPANT' },
                      ],
                    },
                    include: {
                      groupMember: { include: { account: true } },
                      invitations: {
                        where: { status: 'PENDING' },
                        take: 1,
                      },
                    },
                  },
                },
              },
              members: {
                where: { status: 'ACTIVE' },
                include: { account: true },
              },
            },
          },
        },
        orderBy: { group: { createdAt: 'desc' } },
      })
      const uniqueGroups = [
        ...new Map(memberships.map(({ group }) => [group.id, group])).values(),
      ]
      const groupNames = uniqueGroups.map((group) =>
        displayGroupName(group, ctx.auth.user.id),
      )
      const groupNameCounts = countByLower(groupNames)
      const allGroups = uniqueGroups.map((group, index) => {
        const name = groupNames[index]
        const participants = group.ledger.participants.map((participant) => ({
          id: participant.id,
          name:
            participant.groupMember?.account.name ||
            participant.displayName ||
            participant.invitations[0]?.temporaryName ||
            participant.invitations[0]?.email ||
            'Pending participant',
          status: participant.groupMember
            ? ('ACTIVE' as const)
            : participant.invitations.length > 0
              ? ('PENDING' as const)
              : ('UNLINKED' as const),
          isCaller: participant.groupMember?.accountId === ctx.auth.user.id,
        }))
        const participantNameCounts = countByLower(
          participants.map((participant) => participant.name),
        )
        const duplicateName =
          (groupNameCounts.get(name.toLocaleLowerCase()) ?? 0) > 1
        return {
          id: group.id,
          name,
          type: group.groupType,
          currency: group.ledger.currency,
          currencyCode: group.ledger.currencyCode,
          callerParticipantId:
            participants.find((participant) => participant.isCaller)?.id ??
            null,
          participantCount: participants.length,
          participants: participants.map((participant) => ({
            ...participant,
            disambiguationLabel:
              (participantNameCounts.get(
                participant.name.toLocaleLowerCase(),
              ) ?? 0) > 1
                ? `${participant.name} · ${participant.id.slice(-8)}`
                : participant.name,
          })),
          disambiguationLabel: duplicateName
            ? `${name} · ${group.groupType === 'FRIEND' ? 'friend' : 'group'} · ${group.id.slice(0, 8)}`
            : name,
        }
      })

      const hint = input?.groupHint?.toLocaleLowerCase()
      const matched = hint
        ? allGroups.filter(
            (group) =>
              group.name.toLocaleLowerCase().includes(hint) ||
              group.disambiguationLabel.toLocaleLowerCase().includes(hint),
          )
        : allGroups

      return {
        connectedAccount: {
          name: ctx.auth.user.name,
        },
        categories: DEFAULT_CATEGORIES.map(({ id, grouping, name }) => ({
          id,
          grouping,
          name,
        })),
        totalGroups: matched.length,
        truncated: matched.length > GROUP_RESPONSE_CAP,
        groups: matched.slice(0, GROUP_RESPONSE_CAP),
      }
    }),

  getGroupSummary: readProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        recentExpenseLimit: z.number().int().min(1).max(50).default(10),
      }),
    )
    .query(async ({ input, ctx }) => {
      const member = await getAssistantGroup(input.groupId, ctx.auth.user.id)
      const [balances, expenses, savedDefault] = await Promise.all([
        getGroupBalances(input.groupId, member.group.ledger.id),
        getGroupExpenses(input.groupId, {
          ledgerId: member.group.ledger.id,
          length: input.recentExpenseLimit,
        }),
        prisma.accountGroupDefaultSplit.findUnique({
          where: {
            accountId_groupId: {
              accountId: ctx.auth.user.id,
              groupId: input.groupId,
            },
          },
          include: { paidFor: true },
        }),
      ])
      const participants = member.group.ledger.participants.map(
        (participant) => ({
          id: participant.id,
          name:
            participant.groupMember?.account.name ||
            participant.displayName ||
            participant.invitations[0]?.temporaryName ||
            participant.invitations[0]?.email ||
            'Pending participant',
          status: participant.groupMember ? 'ACTIVE' : 'PENDING_OR_UNLINKED',
        }),
      )
      return {
        connectedAccount: {
          name: ctx.auth.user.name,
        },
        group: {
          id: member.group.id,
          name: displayGroupName(member.group, ctx.auth.user.id),
          type: member.group.groupType,
          currency: member.group.ledger.currency,
          currencyCode: member.group.ledger.currencyCode,
        },
        callerParticipantId: member.ledgerParticipant?.id ?? null,
        participants,
        defaultSplit:
          savedDefault && savedDefault.splitMode !== 'ITEMIZED'
            ? {
                mode: savedDefault.splitMode,
                participants: savedDefault.paidFor.map((row) => ({
                  participantId: row.participantId,
                  shares: row.shares,
                })),
              }
            : null,
        balances,
        recentExpenses: expenses.map((expense) => ({
          id: expense.id,
          title: expense.title,
          amount: expense.amount,
          date: expense.expenseDate.toISOString().slice(0, 10),
          category: expense.categoryId,
          paidBy: expense.paidByList,
          paidFor: expense.paidFor,
        })),
      }
    }),

  prepareExpense: writeProcedure
    .input(prepareExpenseInputSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await prepareAssistantExpense(input, ctx.auth.user.id)
        return {
          preview: result.preview,
          confirmationToken: result.confirmationToken,
        }
      } catch (error) {
        if (
          !(error instanceof AssistantExpenseInputError) &&
          !(error instanceof z.ZodError)
        ) {
          throw error
        }
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            error instanceof z.ZodError
              ? (error.issues[0]?.message ?? 'Invalid expense details')
              : error.message,
        })
      }
    }),

  createExpense: writeProcedure
    .input(z.object({ confirmationToken: z.string().min(20) }))
    .mutation(async ({ input, ctx }) => {
      let confirmation: Awaited<ReturnType<typeof openConfirmation>>
      try {
        confirmation = await openConfirmation(input.confirmationToken)
      } catch {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            'This preview expired or is invalid. Ask for a fresh preview.',
        })
      }
      if (confirmation.accountId !== ctx.auth.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'This preview belongs to another account',
        })
      }

      const existing = await prisma.expense.findUnique({
        where: { assistantRequestId: confirmation.requestId },
      })
      if (existing) {
        return {
          expenseId: existing.id,
          groupId: confirmation.groupId,
          alreadyCreated: true,
        }
      }

      const member = await getAssistantGroup(
        confirmation.groupId,
        ctx.auth.user.id,
      ).catch((error) => {
        if (!(error instanceof AssistantExpenseInputError)) throw error
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: error.message,
        })
      })
      const currentParticipants = new Set(
        member.group.ledger.participants.map((participant) => participant.id),
      )
      if (
        (member.group.ledger.currencyCode?.toUpperCase() ?? null) !==
        confirmation.ledgerCurrencyCode
      ) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'The group currency changed. Ask for a fresh preview.',
        })
      }
      for (const participantId of [
        ...confirmation.expense.paidByList.map((row) => row.participant),
        ...confirmation.expense.paidFor.map((row) => row.participant),
        ...(confirmation.expense.items ?? []).flatMap((item) =>
          item.paidFor.map((row) => row.participant),
        ),
        ...(confirmation.expense.itemizedRemainder?.paidFor ?? []).map(
          (row) => row.participant,
        ),
      ]) {
        if (!currentParticipants.has(participantId)) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'The group participants changed. Ask for a fresh preview.',
          })
        }
      }

      try {
        const expense = await createExpense(
          confirmation.expense,
          confirmation.groupId,
          { accountId: ctx.auth.user.id },
          {
            assistantRequestId: confirmation.requestId,
            conversionResolution: confirmation.conversion,
            itemizedPaidForResolution:
              confirmation.expense.splitMode === 'ITEMIZED'
                ? confirmation.expense.paidFor
                : undefined,
          },
        )
        return {
          expenseId: expense.id,
          groupId: confirmation.groupId,
          alreadyCreated: false,
        }
      } catch (error) {
        const raced = await prisma.expense.findUnique({
          where: { assistantRequestId: confirmation.requestId },
        })
        if (raced) {
          return {
            expenseId: raced.id,
            groupId: confirmation.groupId,
            alreadyCreated: true,
          }
        }
        throw error
      }
    }),
})
