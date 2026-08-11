import { vi, type Mock } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'

import type { PrismaClient } from '@spliit/db'

import type { EmailMessage } from '../lib/mail/send'

export type PrismaMock = DeepMockProxy<PrismaClient>

export const prismaMock = mockDeep<PrismaClient>()

export const prisma$Transaction = prismaMock.$transaction as unknown as Mock
export const prisma$QueryRaw = prismaMock.$queryRaw as unknown as Mock

export const authState: {
  session: { user: { id: string }; session: { id: string } } | null
  account: Record<string, unknown> | null
} = {
  session: null,
  account: null,
}

export const sendEmailMock = vi.fn(async (_message: EmailMessage) => undefined)

export function resetPrisma() {
  mockReset(prismaMock)

  prismaMock.accountPreference.findMany.mockResolvedValue([] as never)
  prismaMock.accountPreference.findUnique.mockResolvedValue(null as never)
  prismaMock.expensePaidBy.findMany.mockResolvedValue([] as never)
  prismaMock.expensePaidFor.findMany.mockResolvedValue([] as never)
  prismaMock.expenseItemPaidFor.findMany.mockResolvedValue([] as never)
  prismaMock.expenseItemizedRemainderPaidFor.findMany.mockResolvedValue(
    [] as never,
  )
  prismaMock.group.findUnique.mockResolvedValue({
    id: 'grp-default',
    ledgerId: 'ledger-default',
    ledger: { currencyCode: null },
  } as never)
  prismaMock.activity.create.mockResolvedValue({
    id: 'act-default',
    time: new Date(),
  } as never)
  prisma$Transaction.mockImplementation(async (input: unknown) => {
    if (typeof input === 'function') {
      return (input as (tx: unknown) => unknown)(prismaMock)
    }
    if (Array.isArray(input)) {
      return Promise.all(input)
    }
    return undefined
  })
  prisma$QueryRaw.mockResolvedValue([])
}

export function resetAuth() {
  authState.session = null
  authState.account = null
}
