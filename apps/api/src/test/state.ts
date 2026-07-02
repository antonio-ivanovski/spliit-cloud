import { vi } from 'vitest'

function makeMethodStubs(methods: readonly string[]) {
  const stubs: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const m of methods) stubs[m] = vi.fn(async () => null)
  return stubs
}

export const prismaMock = {
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
    'findUnique',
    'create',
    'createMany',
    'count',
    'deleteMany',
    'updateMany',
    'update',
    'delete',
  ]),
  expensePaidBy: makeMethodStubs([
    'findMany',
    'findUnique',
    'create',
    'createMany',
    'count',
    'deleteMany',
    'updateMany',
    'update',
    'delete',
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

export const prisma$Transaction = vi.fn(async (input: unknown) => {
  if (typeof input === 'function') {
    return (input as (tx: unknown) => unknown)(prismaMock)
  }
  if (Array.isArray(input)) {
    return Promise.all(input)
  }
  return undefined
})

export const prisma$QueryRaw = vi.fn(async () => [])

export const authState: {
  session: { user: { id: string }; session: { id: string } } | null
  account: Record<string, unknown> | null
} = {
  session: null,
  account: null,
}

export const sendEmailMock = vi.fn(async () => undefined)

export function resetPrisma() {
  for (const model of Object.values(prismaMock)) {
    for (const fn of Object.values(model)) {
      fn.mockReset()
      fn.mockResolvedValue(null)
    }
  }
  // `findMany` on the per-expense reference tables defaults to `[]`
  // so the merge path (which walks source rows before rewriting) does
  // not crash when a fixture forgets to stub it.
  prismaMock.expensePaidBy.findMany.mockResolvedValue([] as never)
  prismaMock.expensePaidFor.findMany.mockResolvedValue([] as never)
  // Default for group.findUnique so logActivity's ledger lookup
  // (used by activity writes) does not throw in tests that don't
  // explicitly set up the mock.
  prismaMock.group.findUnique.mockResolvedValue({
    id: 'grp-default',
    ledgerId: 'ledger-default',
  } as never)
  prisma$Transaction.mockReset()
  prisma$Transaction.mockImplementation(async (input: unknown) => {
    if (typeof input === 'function') {
      return (input as (tx: unknown) => unknown)(prismaMock)
    }
    if (Array.isArray(input)) {
      return Promise.all(input)
    }
    return undefined
  })
  prisma$QueryRaw.mockReset()
  prisma$QueryRaw.mockResolvedValue([])
}

export function resetAuth() {
  authState.session = null
  authState.account = null
}
