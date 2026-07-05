import { beforeEach, vi } from 'vitest'
import {
  authState,
  prismaMock,
  resetAuth,
  resetPrisma,
  sendEmailMock,
} from './state'

vi.mock(import('@spliit/db'), async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, prisma: prismaMock }
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
