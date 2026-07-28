import createPrismaMock from 'prisma-mock/client'

import { PrismaClient } from '@spliit/db'
import * as dmmf from '@spliit/db/dmmf'

import { prismaMock } from './state'

/**
 * Bridge prisma-mock's in-memory store onto the vitest-mock-extended
 * `prismaMock`. After calling this, seeded model methods (findUnique, findMany,
 * create, update, delete, …) resolve against an in-memory store instead of
 * requiring manual `mockResolvedValue` calls.
 *
 * Call `resetPrisma()` first to clear any vitest-mock-extended defaults. Seed
 * data keys are lowercase model names, values are arrays of objects.
 *
 * Note: prisma-mock overrides `.mockResolvedValue()` for every model method on
 * prismaMock. Do not mix manual mocks for the same method.
 *
 * Lives in its own file so `state.ts` doesn't import `@spliit/db` at module
 * load — that import would race with `vi.mock('@spliit/db', …)` hoisting in
 * `mocks.ts`.
 */
export function usePrismaMemoryStore(
  initialData?: Record<string, Array<Record<string, unknown>>>,
) {
  createPrismaMock(PrismaClient, {
    datamodel: dmmf,
    mockClient: prismaMock as never,
    ...(initialData ? { data: initialData as never } : {}),
  })
}
