import { createHash, createHmac } from 'node:crypto'

import { TRPCError } from '@trpc/server'
import superjson from 'superjson'
import { z } from 'zod'

import { Prisma, prisma, type Prisma as PrismaTypes } from '@spliit/db'

import { env } from '../env'

export const createRequestIdSchema = z.uuid()

export const CREATE_OPERATIONS = {
  group: 'groups.create',
  expense: 'groups.expenses.create',
  import: 'groups.import',
  cloudImport: 'groups.importCloudBundle',
  budget: 'groups.budgets.create',
  subgroup: 'groups.subgroups.create',
  participant: 'groups.participants.create',
  expenseComment: 'groups.expenses.comments.create',
  emailInvitation: 'invitations.create',
  linkInvitation: 'invitations.createLink',
  friendLedger: 'friends.create',
} as const

export type CreateOperation =
  (typeof CREATE_OPERATIONS)[keyof typeof CREATE_OPERATIONS]

type SharedCreateMutation = {
  mechanism: 'shared'
  operation: CreateOperation
  source: string
  symbol: string
}

type NaturalCreateMutation = {
  mechanism: 'natural'
  reason: string
  source: string
  symbol: string
}

/**
 * Architecture inventory for resource-creating tRPC mutations. The companion
 * test discovers create-named mutations from router source and requires every
 * one to be listed here with either the shared request-id mechanism or a
 * reviewed natural-idempotency mechanism.
 */
export const CREATE_MUTATION_CATALOG = [
  {
    mechanism: 'shared',
    operation: CREATE_OPERATIONS.group,
    source: 'groups/create.procedure.ts',
    symbol: 'createGroupProcedure',
  },
  {
    mechanism: 'shared',
    operation: CREATE_OPERATIONS.expense,
    source: 'groups/expenses/create.procedure.ts',
    symbol: 'createGroupExpenseProcedure',
  },
  {
    mechanism: 'shared',
    operation: CREATE_OPERATIONS.import,
    source: 'groups/import.procedure.ts',
    symbol: 'importGroupProcedure',
  },
  {
    mechanism: 'shared',
    operation: CREATE_OPERATIONS.cloudImport,
    source: 'groups/import-cloud.procedure.ts',
    symbol: 'importCloudBundleProcedure',
  },
  {
    mechanism: 'shared',
    operation: CREATE_OPERATIONS.budget,
    source: 'groups/budgets.ts',
    symbol: 'create',
  },
  {
    mechanism: 'shared',
    operation: CREATE_OPERATIONS.subgroup,
    source: 'groups/subgroups/index.ts',
    symbol: 'createSubgroupProcedure',
  },
  {
    mechanism: 'shared',
    operation: CREATE_OPERATIONS.participant,
    source: 'groups/participants/create.procedure.ts',
    symbol: 'createParticipantProcedure',
  },
  {
    mechanism: 'shared',
    operation: CREATE_OPERATIONS.expenseComment,
    source: 'groups/expenses/comments/create.procedure.ts',
    symbol: 'createExpenseCommentProcedure',
  },
  {
    mechanism: 'shared',
    operation: CREATE_OPERATIONS.emailInvitation,
    source: 'invitations/index.ts',
    symbol: 'create',
  },
  {
    mechanism: 'shared',
    operation: CREATE_OPERATIONS.linkInvitation,
    source: 'invitations/index.ts',
    symbol: 'createLink',
  },
  {
    mechanism: 'shared',
    operation: CREATE_OPERATIONS.friendLedger,
    source: 'friends/index.ts',
    symbol: 'create',
  },
  {
    mechanism: 'natural',
    reason:
      'Assistant confirmations are uniquely keyed by assistantRequestId and retain their specialized confirmation deduplication.',
    source: 'assistant.ts',
    symbol: 'createExpense',
  },
] as const satisfies readonly (SharedCreateMutation | NaturalCreateMutation)[]

type TransactionClient = PrismaTypes.TransactionClient

type EncodedResult = PrismaTypes.InputJsonValue

type ExistingIdempotencyRequest = {
  requestHash: string
  result: unknown
  completedAt: Date | null
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return { $date: value.toISOString() }
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    )
  }
  return value
}

export function idempotencyRequestHash(input: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(input)))
    .digest('hex')
}

export function deriveCreateToken(args: {
  accountId: string
  operation: CreateOperation
  requestId: string
  discriminator: string
}): string {
  const secret = env.BETTER_AUTH_SECRET
  if (!secret) {
    throw new Error(
      'BETTER_AUTH_SECRET is required to derive idempotent invitation tokens',
    )
  }
  return createHmac('sha256', secret)
    .update('spliit:create-token:v1\0')
    .update(args.accountId)
    .update('\0')
    .update(args.operation)
    .update('\0')
    .update(args.requestId)
    .update('\0')
    .update(args.discriminator)
    .digest('hex')
    .slice(0, 32)
}

function defaultEncode<T>(value: T): EncodedResult {
  return superjson.serialize(value) as unknown as EncodedResult
}

function defaultDecode<T>(value: PrismaTypes.JsonValue): T {
  return superjson.deserialize(
    value as unknown as ReturnType<typeof superjson.serialize>,
  )
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  )
}

function replayExisting<T>(
  existing: ExistingIdempotencyRequest,
  requestHash: string,
  decode: (value: PrismaTypes.JsonValue) => T,
): { value: T; replayed: true } {
  if (existing.requestHash !== requestHash) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'This request ID was already used with different input',
    })
  }
  if (existing.result === null || !existing.completedAt) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'This create request is still being processed',
    })
  }
  return {
    value: decode(existing.result as PrismaTypes.JsonValue),
    replayed: true,
  }
}

export async function runIdempotentCreate<T, Prepared = undefined>(args: {
  accountId: string
  operation: CreateOperation
  requestId: string
  input: unknown
  /** Complete external I/O before opening the interactive transaction. */
  prepare?: () => Promise<Prepared>
  execute: (tx: TransactionClient, prepared: Prepared) => Promise<T>
  encode?: (value: T) => EncodedResult
  decode?: (value: PrismaTypes.JsonValue) => T
}): Promise<{ value: T; replayed: boolean }> {
  const requestHash = idempotencyRequestHash(args.input)
  const encode = args.encode ?? defaultEncode<T>
  const decode = args.decode ?? defaultDecode<T>
  const requestKey = {
    accountId_operation_requestId: {
      accountId: args.accountId,
      operation: args.operation,
      requestId: args.requestId,
    },
  }
  const findExisting = () =>
    prisma.idempotencyRequest.findUnique({
      where: requestKey,
      select: { requestHash: true, result: true, completedAt: true },
    })

  const existing = await findExisting()
  if (existing) return replayExisting(existing, requestHash, decode)

  const prepared = args.prepare ? await args.prepare() : (undefined as Prepared)

  try {
    const value = await prisma.$transaction(async (tx) => {
      await tx.idempotencyRequest.create({
        data: {
          accountId: args.accountId,
          operation: args.operation,
          requestId: args.requestId,
          requestHash,
        },
      })

      const created = await args.execute(tx, prepared)
      await tx.idempotencyRequest.update({
        where: requestKey,
        data: {
          result: encode(created),
          completedAt: new Date(),
        },
      })
      return created
    })
    return { value, replayed: false }
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error

    const racedRequest = await findExisting()
    if (!racedRequest) throw error
    return replayExisting(racedRequest, requestHash, decode)
  }
}
