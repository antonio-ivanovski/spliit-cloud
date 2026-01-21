import {
  createSession,
  deleteAllUserSessions,
  deleteSession,
  generateSessionToken,
  validateSession,
} from './session'

jest.mock('../prisma', () => ({
  prisma: {
    syncSession: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}))

const prismaMock = jest.requireMock('../prisma').prisma as {
  syncSession: {
    create: jest.Mock
    findUnique: jest.Mock
    update: jest.Mock
    delete: jest.Mock
    deleteMany: jest.Mock
  }
}

describe('session utilities', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2025-01-01T00:00:00.000Z'))
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('generateSessionToken returns 64-char hex string', () => {
    const token = generateSessionToken()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('createSession creates DB record with correct expiry (30 days)', async () => {
    const { token, expiresAt } = await createSession('user-1')

    expect(prismaMock.syncSession.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        token,
        expiresAt,
      },
    })
    expect(expiresAt.getTime() - Date.now()).toBe(30 * 24 * 60 * 60 * 1000)
  })

  it('validateSession returns null for invalid token', async () => {
    prismaMock.syncSession.findUnique.mockResolvedValue(null)

    await expect(validateSession('bad-token')).resolves.toBeNull()
    expect(prismaMock.syncSession.delete).not.toHaveBeenCalled()
  })

  it('validateSession returns user for valid token', async () => {
    const expiresAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
    const session = {
      id: 'session-1',
      userId: 'user-1',
      expiresAt,
      user: {
        id: 'user-1',
        email: 'test@example.com',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        googleId: null,
        githubId: null,
      },
    }
    prismaMock.syncSession.findUnique.mockResolvedValue(session)

    await expect(validateSession('good-token')).resolves.toEqual({
      userId: 'user-1',
      user: session.user,
    })
    expect(prismaMock.syncSession.update).not.toHaveBeenCalled()
  })

  it('validateSession refreshes token when near expiry', async () => {
    const expiresAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    prismaMock.syncSession.findUnique.mockResolvedValue({
      id: 'session-2',
      userId: 'user-2',
      expiresAt,
      user: {
        id: 'user-2',
        email: 'refresh@example.com',
        createdAt: new Date('2024-01-02T00:00:00.000Z'),
        googleId: null,
        githubId: null,
      },
    })

    await validateSession('refresh-token')

    expect(prismaMock.syncSession.update).toHaveBeenCalledWith({
      where: { id: 'session-2' },
      data: { expiresAt: expect.any(Date) },
    })
  })

  it('deleteSession removes session', async () => {
    await deleteSession('token-1')

    expect(prismaMock.syncSession.deleteMany).toHaveBeenCalledWith({
      where: { token: 'token-1' },
    })
  })

  it('deleteAllUserSessions removes all user sessions', async () => {
    await deleteAllUserSessions('user-3')

    expect(prismaMock.syncSession.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-3' },
    })
  })
})
