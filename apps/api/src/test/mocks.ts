import { beforeEach, vi } from 'vitest'
import {
  authState,
  prisma$QueryRaw,
  prisma$Transaction,
  prismaMock,
  resetAuth,
  resetPrisma,
  sendEmailMock,
} from './state'

vi.mock('@spliit/db', () => {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === '$transaction') return prisma$Transaction
      if (prop === '$queryRaw') return prisma$QueryRaw
      return new Proxy(function () {}, {
        get(_t, method) {
          const model = (prismaMock as Record<string, Record<string, unknown>>)[
            prop as string
          ]
          if (model && typeof model === 'object') {
            const fn = model[method as string]
            if (typeof fn === 'function') return fn
          }
          return undefined
        },
      })
    },
  }
  const livePrisma = new Proxy({}, handler)

  return {
    prisma: livePrisma,
    GroupRole: {
      ADMIN: 'ADMIN',
      MEMBER: 'MEMBER',
    },
    GroupMemberStatus: {
      PENDING: 'PENDING',
      ACTIVE: 'ACTIVE',
      LEFT: 'LEFT',
      REMOVED: 'REMOVED',
      SUSPENDED: 'SUSPENDED',
    },
    GroupInvitationStatus: {
      PENDING: 'PENDING',
      ACCEPTED: 'ACCEPTED',
      DECLINED: 'DECLINED',
      REVOKED: 'REVOKED',
    },
    GroupInvitationType: {
      EMAIL: 'EMAIL',
      LINK: 'LINK',
    },
    ActivityType: {
      UPDATE_GROUP: 'UPDATE_GROUP',
      CREATE_EXPENSE: 'CREATE_EXPENSE',
      UPDATE_EXPENSE: 'UPDATE_EXPENSE',
      DELETE_EXPENSE: 'DELETE_EXPENSE',
    },
    SplitMode: {
      EVENLY: 'EVENLY',
      BY_SHARES: 'BY_SHARES',
      BY_PERCENTAGE: 'BY_PERCENTAGE',
      BY_AMOUNT: 'BY_AMOUNT',
    },
    RecurrenceRule: {
      NONE: 'NONE',
      DAILY: 'DAILY',
      WEEKLY: 'WEEKLY',
      MONTHLY: 'MONTHLY',
    },
    Prisma: {
      Decimal: { isDecimal: (_v: unknown) => false },
    },
  }
})

vi.mock('../lib/auth/index', () => ({
  auth: {
    api: {
      getSession: async () => authState.session,
    },
  },
}))

vi.mock('../lib/mail/send', () => ({
  sendEmail: sendEmailMock,
}))

beforeEach(() => {
  resetPrisma()
  resetAuth()
  sendEmailMock.mockClear()
})
