import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { prisma } from '@spliit/db'
import {
  personalExpenseOverrideInputSchema,
  personalGroupRuleInputSchema,
} from '@spliit/domain'

import { randomId } from '../../../lib/api/shared'
import {
  getPersonalExpenseStatus,
  PersonalInclusionService,
  runPersonalSyncResult,
} from '../../../lib/personal/inclusion'
import {
  ensurePersonalProfile,
  parseIsoDate,
  personalHasData,
  toIsoDate,
} from '../../../lib/personal/profile'
import { createTRPCRouter, protectedProcedure } from '../../init'
import {
  listPersonalSourcesOutputSchema,
  personalExpenseStatusSchema,
  reconcilePersonalOutputSchema,
  setPersonalExpenseOverrideOutputSchema,
  updatePersonalGroupRuleOutputSchema,
} from '../../outputs/personal'

async function requireMembership(accountId: string, groupId: string) {
  const member = await prisma.groupMember.findFirst({
    where: { accountId, groupId, status: 'ACTIVE' },
    select: { id: true },
  })
  if (!member) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You are not an active member of this group',
    })
  }
}

export const personalSourcesRouter = createTRPCRouter({
  list: protectedProcedure
    .output(listPersonalSourcesOutputSchema)
    .query(async ({ ctx }) => {
      const accountId = ctx.auth.user.id
      const [profile, hasData] = await Promise.all([
        ensurePersonalProfile(accountId),
        personalHasData(accountId),
      ])
      const memberships = await prisma.groupMember.findMany({
        where: { accountId, status: 'ACTIVE' },
        select: {
          group: {
            select: {
              id: true,
              name: true,
              groupType: true,
              ledger: { select: { id: true } },
              _count: {
                select: {
                  members: { where: { status: 'ACTIVE' } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      })

      const rules = await prisma.personalGroupRule.findMany({
        where: { accountId },
        select: { groupId: true, included: true, includeFrom: true },
      })
      const ruleByGroup = new Map(rules.map((rule) => [rule.groupId, rule]))

      const counts = await prisma.expense.groupBy({
        by: ['ledgerId'],
        where: {
          ledgerId: { in: memberships.map(({ group }) => group.ledger.id) },
          categoryId: { not: 'settlement' },
          paidFor: {
            some: { ledgerParticipant: { groupMember: { accountId } } },
          },
        },
        _count: { _all: true },
      })
      const countByLedger = new Map(
        counts.map((row) => [row.ledgerId, row._count._all]),
      )

      const groups = memberships.map(({ group }) => {
        const rule = ruleByGroup.get(group.id)
        return {
          groupId: group.id,
          name: group.name,
          type: group.groupType,
          included: rule?.included ?? false,
          includeFrom: rule?.includeFrom ? toIsoDate(rule.includeFrom) : null,
          memberCount: group._count.members,
          expenseCount: countByLedger.get(group.ledger.id) ?? 0,
        }
      })

      return {
        profile: {
          currencyCode: profile.currencyCode,
          timeZone: profile.timeZone,
          sharedEnabled: profile.sharedEnabled,
          hasData,
          canChangeCurrency: !hasData,
        },
        groups,
      }
    }),

  updateRule: protectedProcedure
    .input(personalGroupRuleInputSchema)
    .output(updatePersonalGroupRuleOutputSchema)
    .mutation(async ({ input, ctx }) => {
      const accountId = ctx.auth.user.id
      await requireMembership(accountId, input.groupId)
      await ensurePersonalProfile(accountId)

      await prisma.personalGroupRule.upsert({
        where: {
          accountId_groupId: {
            accountId,
            groupId: input.groupId,
          },
        },
        create: {
          id: randomId(),
          accountId,
          groupId: input.groupId,
          included: input.included,
          includeFrom: input.includeFrom
            ? parseIsoDate(input.includeFrom)
            : null,
        },
        update: {
          included: input.included,
          includeFrom: input.includeFrom
            ? parseIsoDate(input.includeFrom)
            : null,
        },
      })

      const synced = await runPersonalSyncResult(
        PersonalInclusionService.use((service) =>
          service.syncGroup(accountId, input.groupId),
        ),
      ).catch((error: unknown) => {
        throw new TRPCError({
          code: 'BAD_GATEWAY',
          message:
            error instanceof Error
              ? error.message
              : 'Could not sync group expenses',
        })
      })

      return { synced }
    }),

  setExpenseOverride: protectedProcedure
    .input(personalExpenseOverrideInputSchema)
    .output(setPersonalExpenseOverrideOutputSchema)
    .mutation(async ({ input, ctx }) => {
      const accountId = ctx.auth.user.id
      const expense = await prisma.expense.findUnique({
        where: { id: input.expenseId },
        select: {
          id: true,
          ledger: { select: { group: { select: { id: true } } } },
        },
      })
      const groupId = expense?.ledger.group?.id
      if (!expense || !groupId) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Group expense not found',
        })
      }
      await requireMembership(accountId, groupId)

      if (input.state === null && input.categoryId === null) {
        await prisma.personalExpenseOverride.deleteMany({
          where: { accountId, expenseId: input.expenseId },
        })
      } else {
        await prisma.personalExpenseOverride.upsert({
          where: {
            accountId_expenseId: {
              accountId,
              expenseId: input.expenseId,
            },
          },
          create: {
            id: randomId(),
            accountId,
            expenseId: input.expenseId,
            state: input.state ?? null,
            categoryId: input.categoryId ?? null,
          },
          update: {
            state: input.state ?? null,
            categoryId: input.categoryId ?? null,
          },
        })
      }

      await runPersonalSyncResult(
        PersonalInclusionService.use((service) =>
          service.syncExpenseForAccount(input.expenseId, accountId),
        ),
      )

      const status = await getPersonalExpenseStatus(accountId, input.expenseId)
      return { included: status.included }
    }),

  reconcile: protectedProcedure
    .output(reconcilePersonalOutputSchema)
    .mutation(async ({ ctx }) => {
      const synced = await runPersonalSyncResult(
        PersonalInclusionService.use((service) =>
          service.reconcile(ctx.auth.user.id),
        ),
      )
      return { synced }
    }),
})

export const personalExpensesRouter = createTRPCRouter({
  getStatus: protectedProcedure
    .input(z.object({ expenseId: z.string().min(1) }))
    .output(personalExpenseStatusSchema)
    .query(async ({ input, ctx }) => {
      return getPersonalExpenseStatus(ctx.auth.user.id, input.expenseId)
    }),
})
