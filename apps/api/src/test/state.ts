import { vi } from 'vitest'

function makeMethodStubs(methods: readonly string[]) {
  const stubs: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const m of methods) stubs[m] = vi.fn(async () => null)
  return stubs
}

const hoisted = vi.hoisted(() => {
  const prismaMock = {
    account: makeMethodStubs([
      'findUnique',
      'findFirst',
      'findMany',
      'create',
      'update',
      'upsert',
    ]),
    authIdentity: makeMethodStubs(['findMany']),
    group: makeMethodStubs([
      'findUnique',
      'findFirst',
      'findMany',
      'create',
      'update',
      'delete',
    ]),
    groupMember: makeMethodStubs([
      'findUnique',
      'findFirst',
      'findMany',
      'create',
      'count',
      'update',
      'upsert',
      'delete',
    ]),
    groupInvitation: makeMethodStubs([
      'findUnique',
      'findFirst',
      'findMany',
      'create',
      'update',
      'updateMany',
      'delete',
    ]),
    ledger: makeMethodStubs([
      'findUnique',
      'findFirst',
      'findMany',
      'create',
      'update',
    ]),
    ledgerParticipant: makeMethodStubs([
      'findUnique',
      'findFirst',
      'findMany',
      'create',
      'update',
      'upsert',
      'delete',
    ]),
    expense: makeMethodStubs([
      'findUnique',
      'findFirst',
      'findMany',
      'create',
      'update',
      'updateMany',
      'delete',
      'deleteMany',
    ]),
    expensePaidFor: makeMethodStubs([
      'findMany',
      'create',
      'createMany',
      'count',
      'deleteMany',
      'updateMany',
    ]),
    expensePaidBy: makeMethodStubs([
      'findMany',
      'create',
      'createMany',
      'count',
      'deleteMany',
      'updateMany',
    ]),
    recurringExpenseLink: makeMethodStubs([
      'findUnique',
      'findFirst',
      'findMany',
      'create',
      'update',
      'delete',
    ]),
    activity: makeMethodStubs(['findMany', 'create']),
    session: makeMethodStubs(['findUnique', 'findMany', 'create', 'delete']),
    accountGroupPreference: makeMethodStubs([
      'findUnique',
      'findFirst',
      'findMany',
      'create',
      'update',
      'upsert',
    ]),
  }

  const $transaction = vi.fn(async (input: unknown) => {
    if (typeof input === 'function') {
      return (input as (tx: unknown) => unknown)(prismaMock)
    }
    if (Array.isArray(input)) {
      return Promise.all(input)
    }
    return undefined
  })

  const $queryRaw = vi.fn(async () => [])

  const auth: {
    session: { user: { id: string }; session: { id: string } } | null
    account: Record<string, unknown> | null
  } = {
    session: null,
    account: null,
  }

  const sendEmail = vi.fn(async () => undefined)

  function resetPrisma() {
    for (const model of Object.values(prismaMock)) {
      for (const fn of Object.values(model)) {
        fn.mockReset()
        fn.mockResolvedValue(null)
      }
    }
    $transaction.mockReset()
    $transaction.mockImplementation(async (input: unknown) => {
      if (typeof input === 'function') {
        return (input as (tx: unknown) => unknown)(prismaMock)
      }
      if (Array.isArray(input)) {
        return Promise.all(input)
      }
      return undefined
    })
    $queryRaw.mockReset()
    $queryRaw.mockResolvedValue([])
  }

  function resetAuth() {
    auth.session = null
    auth.account = null
  }

  return {
    prismaMock,
    $transaction,
    $queryRaw,
    auth,
    sendEmail,
    resetPrisma,
    resetAuth,
  }
})

// Re-export the live hoisted objects. Mutations to these (e.g.
// `prismaMock.account.findUnique.mockResolvedValueOnce(...)` or
// `authState.session = {...}`) are visible to the production code that
// imports `@spliit/db` and the better-auth module because the mocks use the
// same references via getters (see mocks.ts).
export const prismaMock = hoisted.prismaMock
export const prisma$Transaction = hoisted.$transaction
export const prisma$QueryRaw = hoisted.$queryRaw
export const authState = hoisted.auth
export const sendEmailMock = hoisted.sendEmail
export const resetPrisma = hoisted.resetPrisma
export const resetAuth = hoisted.resetAuth
