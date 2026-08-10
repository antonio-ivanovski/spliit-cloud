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

type TransactionClient = PrismaTypes.TransactionClient

type EncodedResult = PrismaTypes.InputJsonValue

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return { $date: value.toISOString() }
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
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
    .digest('base64url')
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

export async function runIdempotentCreate<T>(args: {
  accountId: string
  operation: CreateOperation
  requestId: string
  input: unknown
  execute: (tx: TransactionClient) => Promise<T>
  encode?: (value: T) => EncodedResult
  decode?: (value: PrismaTypes.JsonValue) => T
}): Promise<{ value: T; replayed: boolean }> {
  const requestHash = idempotencyRequestHash(args.input)
  const encode = args.encode ?? defaultEncode<T>
  const decode = args.decode ?? defaultDecode<T>

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

      const created = await args.execute(tx)
      await tx.idempotencyRequest.update({
        where: {
          accountId_operation_requestId: {
            accountId: args.accountId,
            operation: args.operation,
            requestId: args.requestId,
          },
        },
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

    const existing = await prisma.idempotencyRequest.findUnique({
      where: {
        accountId_operation_requestId: {
          accountId: args.accountId,
          operation: args.operation,
          requestId: args.requestId,
        },
      },
      select: { requestHash: true, result: true, completedAt: true },
    })
    if (!existing) throw error
    if (existing.requestHash !== requestHash) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'This request ID was already used with different input',
      })
    }
    if (!existing.result || !existing.completedAt) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'This create request is still being processed',
      })
    }
    return { value: decode(existing.result), replayed: true }
  }
}
