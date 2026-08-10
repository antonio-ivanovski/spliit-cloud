import { randomUUID } from 'node:crypto'

import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { GroupType, prisma, type Prisma } from '@spliit/db'

import {
  buildGroupActivityData,
  logActivity,
} from '../../../../lib/api/activities'
import {
  CREATE_OPERATIONS,
  createRequestIdSchema,
  runIdempotentCreate,
} from '../../../../lib/api/idempotency'
import {
  listSubgroups,
  mapSubgroup,
  subgroupWithMembersSelect,
} from '../../../../lib/api/subgroups'
import {
  createTRPCRouter,
  hashLinkInviteToken,
  linkInviteTokenInput,
  loadGroupContext,
  loadGroupViewer,
  protectedProcedure,
} from '../../../init'
import {
  listSubgroupsOutputSchema,
  subgroupEnabledOutputSchema,
  subgroupDeletedOutputSchema,
  subgroupMutationOutputSchema,
} from '../../../outputs/subgroups'

const groupIdInput = z.object({ groupId: z.string().min(1) })
const participantIds = z.array(z.string().min(1)).min(2).max(500)
const subgroupFields = z.object({
  name: z.string().trim().min(1).max(120),
  participantIds,
})

async function requireAdmin(groupId: string, accountId: string) {
  const context = await loadGroupContext({ groupId, accountId })
  if (context.group.groupType === GroupType.FRIEND) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Friend ledgers do not support subgroups',
    })
  }
  if (context.group.archived) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This group is archived; subgroup management is disabled',
    })
  }
  if (context.member.role !== 'ADMIN') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only admins can manage subgroups',
    })
  }
  return context
}

function normalizeParticipantIds(ids: string[]) {
  const normalized = [...new Set(ids)]
  if (normalized.length < 2) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'A subgroup needs at least two participants',
    })
  }
  return normalized
}

async function assertParticipants(
  ledgerId: string,
  ids: string[],
  subgroupId?: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const normalized = normalizeParticipantIds(ids)
  const participants = await client.ledgerParticipant.findMany({
    where: { ledgerId, id: { in: normalized }, removedAt: null },
    select: { id: true },
  })
  if (participants.length !== normalized.length) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Select only current group participants',
    })
  }

  const existingMembership = await client.subgroupMember.findFirst({
    where: {
      ledgerParticipantId: { in: normalized },
      ...(subgroupId ? { subgroupId: { not: subgroupId } } : {}),
    },
    select: { subgroup: { select: { name: true } } },
  })
  if (existingMembership) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: `A participant already belongs to ${existingMembership.subgroup.name}`,
    })
  }
  return normalized
}

function mapWriteError(error: unknown): never {
  if (error instanceof TRPCError) throw error
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (code === 'P2002') {
      const target = (error as { meta?: { target?: unknown } }).meta?.target
      const targetText = Array.isArray(target)
        ? target.join('.')
        : String(target)
      throw new TRPCError({
        code: 'CONFLICT',
        message: targetText.includes('ledgerParticipantId')
          ? 'A participant already belongs to another subgroup'
          : 'A subgroup with this name already exists',
      })
    }
  }
  throw error
}

export const listSubgroupsProcedure = protectedProcedure
  .input(
    groupIdInput.extend({
      linkInviteToken: linkInviteTokenInput.describe(
        'Raw link-invite token from the share URL. Grants read access to pending link-invitees.',
      ),
    }),
  )
  .output(listSubgroupsOutputSchema)
  .query(async ({ input, ctx }) => {
    await loadGroupViewer({
      groupId: input.groupId,
      accountId: ctx.auth.user.id,
      accountEmail: ctx.auth.user.email,
      linkTokenHash: await hashLinkInviteToken(input.linkInviteToken),
    })
    const result = await listSubgroups(input.groupId)
    if (!result)
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' })
    return result
  })

export const setSubgroupsEnabledProcedure = protectedProcedure
  .input(groupIdInput.extend({ enabled: z.boolean() }))
  .output(subgroupEnabledOutputSchema)
  .mutation(async ({ input, ctx }) => {
    const { group } = await requireAdmin(input.groupId, ctx.auth.user.id)
    if (group.subgroupsEnabled === input.enabled) {
      return { enabled: input.enabled }
    }
    await prisma.$transaction(async (tx) => {
      if (!input.enabled)
        await tx.subgroup.deleteMany({ where: { groupId: input.groupId } })
      await tx.group.update({
        where: { id: input.groupId },
        data: { subgroupsEnabled: input.enabled },
      })
      await logActivity(
        input.groupId,
        {
          type: 'GROUP_UPDATED',
          actor: { type: 'ACCOUNT', id: ctx.auth.user.id },
          subject: { type: 'GROUP', id: input.groupId },
          data: buildGroupActivityData({
            summary: input.enabled ? 'subgroups:enabled' : 'subgroups:disabled',
            changedFields: ['subgroupsEnabled'],
            changes: [
              {
                field: 'subgroupsEnabled',
                before: input.enabled ? 'Disabled' : 'Enabled',
                after: input.enabled ? 'Enabled' : 'Disabled',
              },
            ],
          }),
        },
        tx,
      )
    })
    return { enabled: input.enabled }
  })

export const createSubgroupProcedure = protectedProcedure
  .input(
    groupIdInput
      .extend({ requestId: createRequestIdSchema })
      .merge(subgroupFields),
  )
  .output(subgroupMutationOutputSchema)
  .mutation(async ({ input, ctx }) => {
    const { group } = await requireAdmin(input.groupId, ctx.auth.user.id)
    if (!group.subgroupsEnabled) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Enable subgroups first',
      })
    }
    try {
      const { value } = await runIdempotentCreate({
        accountId: ctx.auth.user.id,
        operation: CREATE_OPERATIONS.subgroup,
        requestId: input.requestId,
        input: {
          groupId: input.groupId,
          name: input.name,
          participantIds: input.participantIds,
        },
        execute: async (tx) => {
          const ids = await assertParticipants(
            group.ledgerId,
            input.participantIds,
            undefined,
            tx,
          )
          const subgroup = await tx.subgroup.create({
            data: {
              id: randomUUID(),
              groupId: input.groupId,
              name: input.name,
              members: {
                create: ids.map((ledgerParticipantId) => ({
                  ledgerParticipantId,
                })),
              },
            },
            select: subgroupWithMembersSelect,
          })
          return { subgroup: mapSubgroup(subgroup) }
        },
      })
      return value
    } catch (error) {
      mapWriteError(error)
    }
  })

export const updateSubgroupProcedure = protectedProcedure
  .input(
    groupIdInput
      .extend({ subgroupId: z.string().min(1) })
      .merge(subgroupFields),
  )
  .output(subgroupMutationOutputSchema)
  .mutation(async ({ input, ctx }) => {
    const { group } = await requireAdmin(input.groupId, ctx.auth.user.id)
    if (!group.subgroupsEnabled) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Enable subgroups first',
      })
    }
    try {
      const subgroup = await prisma.$transaction(async (tx) => {
        const existing = await tx.subgroup.findFirst({
          where: { id: input.subgroupId, groupId: input.groupId },
          select: { id: true },
        })
        if (!existing) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Subgroup not found',
          })
        }
        const ids = await assertParticipants(
          group.ledgerId,
          input.participantIds,
          input.subgroupId,
          tx,
        )
        await tx.subgroupMember.deleteMany({
          where: { subgroupId: input.subgroupId },
        })
        return tx.subgroup.update({
          where: { id: input.subgroupId },
          data: {
            name: input.name,
            members: {
              create: ids.map((ledgerParticipantId) => ({
                ledgerParticipantId,
              })),
            },
          },
          select: subgroupWithMembersSelect,
        })
      })
      return { subgroup: mapSubgroup(subgroup) }
    } catch (error) {
      mapWriteError(error)
    }
  })

export const deleteSubgroupProcedure = protectedProcedure
  .input(groupIdInput.extend({ subgroupId: z.string().min(1) }))
  .output(subgroupDeletedOutputSchema)
  .mutation(async ({ input, ctx }) => {
    await requireAdmin(input.groupId, ctx.auth.user.id)
    const deleted = await prisma.subgroup.deleteMany({
      where: { id: input.subgroupId, groupId: input.groupId },
    })
    if (deleted.count === 0)
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Subgroup not found' })
    return { deleted: true }
  })

export const groupSubgroupsRouter = createTRPCRouter({
  list: listSubgroupsProcedure,
  setEnabled: setSubgroupsEnabledProcedure,
  create: createSubgroupProcedure,
  update: updateSubgroupProcedure,
  delete: deleteSubgroupProcedure,
})
