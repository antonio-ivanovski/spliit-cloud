import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { Prisma, prisma } from '@spliit/db'
import { splitPresetSchema } from '@spliit/domain'
import type { SavedSplitPreset } from '@spliit/domain'

import {
  CREATE_OPERATIONS,
  createRequestIdSchema,
  runIdempotentCreate,
} from '../../../../lib/api/idempotency'
import { randomId } from '../../../../lib/api/shared'
import {
  canonicalizePreset,
  clearPresetDefaultTarget,
  normalizeSplitPresetName,
  scopeKeyFor,
  type SplitPresetScope,
  type SplitPresetTarget,
} from '../../../../lib/api/split-presets'
import {
  createTRPCRouter,
  loadGroupMutationContext,
  protectedProcedure,
} from '../../../init'
import {
  splitPresetDefaultsOutputSchema,
  splitPresetDeleteOutputSchema,
  splitPresetListOutputSchema,
  splitPresetMutationOutputSchema,
} from '../../../outputs/split-presets'

const groupIdInput = z.object({ groupId: z.string().min(1) })
const nameSchema = z.string().trim().min(1).max(120)
const scopeSchema = z.enum(['SHARED', 'PERSONAL'])
const presetInputSchema = splitPresetSchema
const defaultModeSchema = z.enum(['INHERIT', 'PRESET', 'NEUTRAL'])

const presetSelect = {
  id: true,
  name: true,
  nameKey: true,
  scopeKey: true,
  ownerAccountId: true,
  createdAt: true,
  updatedAt: true,
  target: true,
  splitMode: true,
  participants: {
    orderBy: { participantId: 'asc' as const },
    select: { participantId: true, shares: true },
  },
} as const satisfies Prisma.SplitPresetSelect

type PresetRecord = Prisma.SplitPresetGetPayload<{
  select: typeof presetSelect
}>

function mapPreset(preset: PresetRecord) {
  return {
    id: preset.id,
    name: preset.name,
    scope: preset.ownerAccountId ? ('PERSONAL' as const) : ('SHARED' as const),
    ownerAccountId: preset.ownerAccountId,
    createdAt: preset.createdAt,
    updatedAt: preset.updatedAt,
    target: preset.target,
    splitMode: preset.splitMode as 'EVENLY' | 'BY_SHARES' | 'BY_PERCENTAGE',
    participants: preset.participants.map(({ participantId, shares }) => ({
      participant: participantId,
      shares,
    })),
  }
}

function mapWriteError(error: unknown): never {
  if (error instanceof TRPCError) throw error
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A split preset with this name already exists in this library',
      })
    }
    if (error.code === 'P2025') {
      throw new TRPCError({
        code: 'CONFLICT',
        message:
          'The split preset changed or was deleted; reload and try again',
      })
    }
  }
  throw error
}

async function assertCurrentParticipants(
  ledgerId: string,
  preset: SavedSplitPreset,
  client: typeof prisma | Prisma.TransactionClient = prisma,
) {
  const ids = preset.participants.map((row) => row.participant)
  const uniqueIds = [...new Set(ids)]
  const participants = await client.ledgerParticipant.findMany({
    where: {
      // IDs are globally unique, but the ledger constraint is still part of
      // the authorization boundary: a preset may only reference a current
      // participant from this group.
      ledgerId,
      id: { in: uniqueIds },
      removedAt: null,
      OR: [
        { groupMember: { status: 'ACTIVE' } },
        { invitations: { some: { status: 'PENDING' } } },
        { kind: 'UNLINKED_PARTICIPANT' },
      ],
    },
    select: { id: true },
  })
  if (participants.length !== uniqueIds.length) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Select only current group participants',
    })
  }
}

function rowsCreate(preset: SavedSplitPreset) {
  return preset.participants.map((row) => ({
    participantId: row.participant,
    shares: row.shares,
  }))
}

async function requireContext(groupId: string, accountId: string) {
  const context = await loadGroupMutationContext({ groupId, accountId })
  if (context.group.archived) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This group is archived; split preset changes are disabled',
    })
  }
  return context
}

async function requireScopeAccess(
  groupId: string,
  accountId: string,
  scope: SplitPresetScope,
) {
  const context = await requireContext(groupId, accountId)
  if (scope === 'SHARED' && context.member.role !== 'ADMIN') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only admins can manage shared split presets',
    })
  }
  return context
}

async function assertGroupWritable(
  client: Prisma.TransactionClient,
  groupId: string,
) {
  const group = await client.group.findUnique({
    where: { id: groupId },
    select: { archived: true },
  })
  if (!group || group.archived) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This group is archived; split preset changes are disabled',
    })
  }
}

function scopeWhere(
  scope: SplitPresetScope,
  accountId: string,
): Prisma.SplitPresetWhereInput {
  return scope === 'SHARED'
    ? { ownerAccountId: null, scopeKey: 'GROUP' }
    : { ownerAccountId: accountId, scopeKey: scopeKeyFor(scope, accountId) }
}

function defaultChoice(
  mode: 'INHERIT' | 'PRESET' | 'NEUTRAL',
  presetId: string | null,
) {
  if (mode === 'PRESET' && !presetId) {
    return { mode: 'INHERIT' as const, presetId: null }
  }
  return { mode, presetId: mode === 'PRESET' ? presetId : null }
}

async function readPreference(accountId: string, groupId: string) {
  return prisma.accountGroupPreference.findUnique({
    where: { accountId_groupId: { accountId, groupId } },
    select: {
      paidByDefaultMode: true,
      paidByDefaultPresetId: true,
      paidForDefaultMode: true,
      paidForDefaultPresetId: true,
    },
  })
}

function effectiveDefault(
  personalMode: 'INHERIT' | 'PRESET' | 'NEUTRAL',
  personalId: string | null,
  groupId: string | null,
) {
  if (personalMode === 'PRESET') return personalId ?? groupId
  if (personalMode === 'NEUTRAL') return null
  return groupId
}

function comparePreset(
  left: PresetRecord,
  right: PresetRecord,
  defaultIds: ReadonlySet<string>,
) {
  const scopeOrder = (preset: PresetRecord) => (preset.ownerAccountId ? 0 : 1)
  return (
    scopeOrder(left) - scopeOrder(right) ||
    Number(!defaultIds.has(left.id)) - Number(!defaultIds.has(right.id)) ||
    (left.nameKey < right.nameKey
      ? -1
      : left.nameKey > right.nameKey
        ? 1
        : 0) ||
    left.createdAt.getTime() - right.createdAt.getTime() ||
    left.id.localeCompare(right.id)
  )
}

async function listSplitPresets(
  groupId: string,
  accountId: string,
  context: Awaited<ReturnType<typeof loadGroupMutationContext>>,
) {
  const [presets, preference] = await Promise.all([
    prisma.splitPreset.findMany({
      where: {
        groupId: context.group.id,
        OR: [
          { ownerAccountId: null, scopeKey: 'GROUP' },
          {
            ownerAccountId: accountId,
            scopeKey: scopeKeyFor('PERSONAL', accountId),
          },
        ],
      },
      orderBy: [{ nameKey: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: presetSelect,
    }),
    readPreference(accountId, context.group.id),
  ])
  const paidByMode = preference?.paidByDefaultMode ?? 'INHERIT'
  const paidForMode = preference?.paidForDefaultMode ?? 'INHERIT'
  const groupPaidBy = context.group.defaultPaidByPresetId ?? null
  const groupPaidFor = context.group.defaultPaidForPresetId ?? null
  const defaultIds = new Set(
    [
      groupPaidBy,
      groupPaidFor,
      preference?.paidByDefaultMode === 'PRESET'
        ? preference.paidByDefaultPresetId
        : null,
      preference?.paidForDefaultMode === 'PRESET'
        ? preference.paidForDefaultPresetId
        : null,
    ].filter((id): id is string => !!id),
  )
  const ordered = presets.toSorted((left, right) =>
    comparePreset(left, right, defaultIds),
  )
  return {
    presets: ordered.map(mapPreset),
    canManageShared: context.member.role === 'ADMIN' && !context.group.archived,
    canManagePersonal: !context.group.archived,
    groupDefaults: {
      paidByPresetId: groupPaidBy,
      paidForPresetId: groupPaidFor,
    },
    personalDefaults: {
      paidBy: defaultChoice(
        paidByMode,
        preference?.paidByDefaultPresetId ?? null,
      ),
      paidFor: defaultChoice(
        paidForMode,
        preference?.paidForDefaultPresetId ?? null,
      ),
    },
    effectiveDefaults: {
      paidByPresetId: effectiveDefault(
        paidByMode,
        preference?.paidByDefaultPresetId ?? null,
        groupPaidBy,
      ),
      paidForPresetId: effectiveDefault(
        paidForMode,
        preference?.paidForDefaultPresetId ?? null,
        groupPaidFor,
      ),
    },
  }
}

export const listSplitPresetsProcedure = protectedProcedure
  .input(groupIdInput)
  .output(splitPresetListOutputSchema)
  .query(async ({ input, ctx }) => {
    const context = await loadGroupMutationContext({
      groupId: input.groupId,
      accountId: ctx.auth.user.id,
    })
    return listSplitPresets(input.groupId, ctx.auth.user.id, context)
  })

export const createSplitPresetProcedure = protectedProcedure
  .input(
    groupIdInput
      .extend({
        requestId: createRequestIdSchema,
        name: nameSchema,
        scope: scopeSchema,
      })
      .and(presetInputSchema),
  )
  .output(splitPresetMutationOutputSchema)
  .mutation(async ({ input, ctx }) => {
    const context = await requireScopeAccess(
      input.groupId,
      ctx.auth.user.id,
      input.scope,
    )
    const normalizedName = normalizeSplitPresetName(input.name)
    const definition = canonicalizePreset(input)
    const scopeKey = scopeKeyFor(input.scope, ctx.auth.user.id)
    try {
      const { value } = await runIdempotentCreate({
        accountId: ctx.auth.user.id,
        operation: CREATE_OPERATIONS.splitPreset,
        requestId: input.requestId,
        input,
        execute: async (tx) => {
          await assertGroupWritable(tx, context.group.id)
          await assertCurrentParticipants(context.ledger.id, definition, tx)
          const preset = await tx.splitPreset.create({
            data: {
              id: randomId(),
              groupId: context.group.id,
              ownerAccountId:
                input.scope === 'PERSONAL' ? ctx.auth.user.id : null,
              scopeKey,
              name: normalizedName.name,
              nameKey: normalizedName.nameKey,
              target: definition.target,
              splitMode: definition.splitMode,
              participants: { create: rowsCreate(definition) },
            },
            select: presetSelect,
          })
          return { preset: mapPreset(preset) }
        },
      })
      return value
    } catch (error) {
      mapWriteError(error)
    }
  })

export const updateSplitPresetProcedure = protectedProcedure
  .input(
    groupIdInput
      .extend({
        presetId: z.string().min(1),
        scope: scopeSchema,
        nextScope: scopeSchema.optional(),
        name: nameSchema,
        expectedUpdatedAt: z.coerce.date(),
      })
      .and(presetInputSchema),
  )
  .output(splitPresetMutationOutputSchema)
  .mutation(async ({ input, ctx }) => {
    const context = await requireScopeAccess(
      input.groupId,
      ctx.auth.user.id,
      input.scope,
    )
    const nextScope = input.nextScope ?? input.scope
    if (nextScope !== input.scope) {
      await requireScopeAccess(input.groupId, ctx.auth.user.id, nextScope)
    }
    const normalizedName = normalizeSplitPresetName(input.name)
    const definition = canonicalizePreset(input)
    try {
      const preset = await prisma.$transaction(async (tx) => {
        await assertGroupWritable(tx, context.group.id)
        const existing = await tx.splitPreset.findFirst({
          where: {
            id: input.presetId,
            groupId: context.group.id,
            ...scopeWhere(input.scope, ctx.auth.user.id),
          },
          select: { id: true, updatedAt: true, target: true },
        })
        if (!existing) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Split preset not found',
          })
        }
        if (
          existing.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
        ) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'The split preset changed; reload and try again',
          })
        }
        await assertCurrentParticipants(context.ledger.id, definition, tx)
        if (existing.target !== definition.target) {
          await clearPresetDefaultTarget(
            existing.id,
            existing.target as SplitPresetTarget,
            tx,
          )
        }
        if (nextScope === 'PERSONAL' && input.scope === 'SHARED') {
          // Group defaults may only point at shared presets. Moving a preset
          // into a personal library must therefore clear the corresponding
          // group-level reference in the same transaction. Clear each side
          // independently so moving one preset cannot erase an unrelated
          // default on the other side.
          await tx.group.updateMany({
            where: { id: context.group.id, defaultPaidByPresetId: existing.id },
            data: { defaultPaidByPresetId: null },
          })
          await tx.group.updateMany({
            where: {
              id: context.group.id,
              defaultPaidForPresetId: existing.id,
            },
            data: { defaultPaidForPresetId: null },
          })
          // Personal defaults may point at a shared preset, but after the move
          // it is private to the caller. Preserve the new owner's selection
          // and reset every other account to inheritance.
          await tx.accountGroupPreference.updateMany({
            where: {
              groupId: context.group.id,
              accountId: { not: ctx.auth.user.id },
              paidByDefaultPresetId: existing.id,
            },
            data: {
              paidByDefaultMode: 'INHERIT',
              paidByDefaultPresetId: null,
            },
          })
          await tx.accountGroupPreference.updateMany({
            where: {
              groupId: context.group.id,
              accountId: { not: ctx.auth.user.id },
              paidForDefaultPresetId: existing.id,
            },
            data: {
              paidForDefaultMode: 'INHERIT',
              paidForDefaultPresetId: null,
            },
          })
        }
        // Claim the version before replacing participant rows. Including the
        // timestamp in the write makes the optimistic check atomic: a second
        // writer waits for this update and then observes `count === 0`.
        const updatedAt = new Date(
          Math.max(Date.now(), input.expectedUpdatedAt.getTime() + 1),
        )
        const claimed = await tx.splitPreset.updateMany({
          where: { id: existing.id, updatedAt: input.expectedUpdatedAt },
          data: {
            name: normalizedName.name,
            nameKey: normalizedName.nameKey,
            ownerAccountId: nextScope === 'PERSONAL' ? ctx.auth.user.id : null,
            scopeKey: scopeKeyFor(nextScope, ctx.auth.user.id),
            target: definition.target,
            splitMode: definition.splitMode,
            updatedAt,
          },
        })
        if (claimed.count !== 1) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'The split preset changed; reload and try again',
          })
        }
        await tx.splitPresetParticipant.deleteMany({
          where: { presetId: existing.id },
        })
        await tx.splitPresetParticipant.createMany({
          data: rowsCreate(definition).map((row) => ({
            presetId: existing.id,
            ...row,
          })),
        })
        const updated = await tx.splitPreset.findUnique({
          where: { id: existing.id },
          select: presetSelect,
        })
        if (!updated) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'The split preset changed; reload and try again',
          })
        }
        return updated
      })
      return { preset: mapPreset(preset) }
    } catch (error) {
      mapWriteError(error)
    }
  })

export const deleteSplitPresetProcedure = protectedProcedure
  .input(
    groupIdInput.extend({ presetId: z.string().min(1), scope: scopeSchema }),
  )
  .output(splitPresetDeleteOutputSchema)
  .mutation(async ({ input, ctx }) => {
    const context = await requireScopeAccess(
      input.groupId,
      ctx.auth.user.id,
      input.scope,
    )
    await prisma.$transaction(async (tx) => {
      await assertGroupWritable(tx, context.group.id)
      const existing = await tx.splitPreset.findFirst({
        where: {
          id: input.presetId,
          groupId: context.group.id,
          ...scopeWhere(input.scope, ctx.auth.user.id),
        },
        select: { id: true, target: true },
      })
      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Split preset not found',
        })
      }
      await clearPresetDefaultTarget(
        existing.id,
        existing.target as SplitPresetTarget,
        tx,
      )
      await tx.splitPreset.delete({ where: { id: existing.id } })
    })
    return { deleted: true as const }
  })

const defaultChoiceInputSchema = z
  .object({
    mode: defaultModeSchema,
    presetId: z.string().min(1).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === 'PRESET' && !value.presetId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['presetId'],
        message: 'A preset is required when the mode is PRESET',
      })
    }
    if (value.mode !== 'PRESET' && value.presetId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['presetId'],
        message: 'Only PRESET defaults may reference a preset',
      })
    }
  })

async function resolveDefaultPreset(
  groupId: string,
  accountId: string,
  target: SplitPresetTarget,
  presetId: string,
  client: typeof prisma | Prisma.TransactionClient = prisma,
) {
  const preset = await client.splitPreset.findFirst({
    where: {
      id: presetId,
      groupId,
      OR: [
        { ownerAccountId: null, scopeKey: 'GROUP' },
        {
          ownerAccountId: accountId,
          scopeKey: scopeKeyFor('PERSONAL', accountId),
        },
      ],
    },
    select: { id: true, target: true },
  })
  if (!preset || preset.target !== target) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Choose a compatible split preset',
    })
  }
  return preset
}

export const setGroupDefaultProcedure = protectedProcedure
  .input(
    groupIdInput.extend({
      target: splitPresetSchema.shape.target,
      presetId: z.string().min(1).nullable(),
    }),
  )
  .output(splitPresetDefaultsOutputSchema)
  .mutation(async ({ input, ctx }) => {
    const context = await requireScopeAccess(
      input.groupId,
      ctx.auth.user.id,
      'SHARED',
    )
    await prisma.$transaction(async (tx) => {
      await assertGroupWritable(tx, context.group.id)
      if (input.presetId) {
        const preset = await resolveDefaultPreset(
          input.groupId,
          ctx.auth.user.id,
          input.target,
          input.presetId,
          tx,
        )
        if (preset) {
          const shared = await tx.splitPreset.findFirst({
            where: {
              id: preset.id,
              groupId: input.groupId,
              ownerAccountId: null,
              scopeKey: 'GROUP',
            },
            select: { id: true },
          })
          if (!shared) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Group defaults must use shared presets',
            })
          }
        }
      }
      await tx.group.update({
        where: { id: context.group.id },
        data:
          input.target === 'PAID_BY'
            ? { defaultPaidByPresetId: input.presetId }
            : { defaultPaidForPresetId: input.presetId },
      })
    })
    const refreshed = await loadGroupMutationContext({
      groupId: input.groupId,
      accountId: ctx.auth.user.id,
    })
    const listed = await listSplitPresets(
      input.groupId,
      ctx.auth.user.id,
      refreshed,
    )
    return {
      groupDefaults: listed.groupDefaults,
      personalDefaults: listed.personalDefaults,
      effectiveDefaults: listed.effectiveDefaults,
    }
  })

export const setPersonalDefaultProcedure = protectedProcedure
  .input(
    groupIdInput.extend({
      target: splitPresetSchema.shape.target,
      choice: defaultChoiceInputSchema,
    }),
  )
  .output(splitPresetDefaultsOutputSchema)
  .mutation(async ({ input, ctx }) => {
    const context = await requireContext(input.groupId, ctx.auth.user.id)
    const presetId =
      input.choice.mode === 'PRESET' ? input.choice.presetId : null
    await prisma.$transaction(async (tx) => {
      await assertGroupWritable(tx, context.group.id)
      if (presetId)
        await resolveDefaultPreset(
          input.groupId,
          ctx.auth.user.id,
          input.target,
          presetId,
          tx,
        )
      await tx.accountGroupPreference.upsert({
        where: {
          accountId_groupId: {
            accountId: ctx.auth.user.id,
            groupId: context.group.id,
          },
        },
        create: {
          id: randomId(),
          accountId: ctx.auth.user.id,
          groupId: context.group.id,
          ...(input.target === 'PAID_BY'
            ? {
                paidByDefaultMode: input.choice.mode,
                paidByDefaultPresetId: presetId,
              }
            : {
                paidForDefaultMode: input.choice.mode,
                paidForDefaultPresetId: presetId,
              }),
        },
        update:
          input.target === 'PAID_BY'
            ? {
                paidByDefaultMode: input.choice.mode,
                paidByDefaultPresetId: presetId,
              }
            : {
                paidForDefaultMode: input.choice.mode,
                paidForDefaultPresetId: presetId,
              },
      })
    })
    const refreshed = await loadGroupMutationContext({
      groupId: input.groupId,
      accountId: ctx.auth.user.id,
    })
    const listed = await listSplitPresets(
      input.groupId,
      ctx.auth.user.id,
      refreshed,
    )
    return {
      groupDefaults: listed.groupDefaults,
      personalDefaults: listed.personalDefaults,
      effectiveDefaults: listed.effectiveDefaults,
    }
  })

export const groupSplitPresetsRouter = createTRPCRouter({
  list: listSplitPresetsProcedure,
  create: createSplitPresetProcedure,
  update: updateSplitPresetProcedure,
  delete: deleteSplitPresetProcedure,
  setGroupDefault: setGroupDefaultProcedure,
  setPersonalDefault: setPersonalDefaultProcedure,
})
