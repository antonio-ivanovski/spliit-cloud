import {
  createMagicLink,
  generateMagicLinkToken,
  validateMagicLink,
} from './magic-link'

jest.mock('../env', () => ({
  env: {
    NEXT_PUBLIC_BASE_URL: 'http://localhost:3000',
  },
}))

jest.mock('../prisma', () => ({
  prisma: {
    magicLinkToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}))

const prismaMock = jest.requireMock('../prisma').prisma as {
  magicLinkToken: {
    create: jest.Mock
    findUnique: jest.Mock
    update: jest.Mock
  }
}

describe('magic link utilities', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2025-01-01T00:00:00.000Z'))
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('generateMagicLinkToken returns 64-char hex string', () => {
    const token = generateMagicLinkToken()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('createMagicLink creates DB record with 15-min expiry', async () => {
    const { token, url } = await createMagicLink('user@example.com')

    expect(prismaMock.magicLinkToken.create).toHaveBeenCalledWith({
      data: {
        email: 'user@example.com',
        token,
        expiresAt: expect.any(Date),
      },
    })
    const expiresAt = prismaMock.magicLinkToken.create.mock.calls[0]?.[0]?.data
      ?.expiresAt as Date
    expect(expiresAt.getTime() - Date.now()).toBe(15 * 60 * 1000)
    expect(url).toContain(`token=${token}`)
  })

  it('validateMagicLink returns null for invalid token', async () => {
    prismaMock.magicLinkToken.findUnique.mockResolvedValue(null)

    await expect(validateMagicLink('bad-token')).resolves.toBeNull()
    expect(prismaMock.magicLinkToken.update).not.toHaveBeenCalled()
  })

  it('validateMagicLink returns email for valid token', async () => {
    prismaMock.magicLinkToken.findUnique.mockResolvedValue({
      id: 'token-1',
      email: 'valid@example.com',
      used: false,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    })

    await expect(validateMagicLink('good-token')).resolves.toEqual({
      email: 'valid@example.com',
    })
  })

  it('validateMagicLink returns null for expired token', async () => {
    prismaMock.magicLinkToken.findUnique.mockResolvedValue({
      id: 'token-2',
      email: 'expired@example.com',
      used: false,
      expiresAt: new Date(Date.now() - 1000),
    })

    await expect(validateMagicLink('expired-token')).resolves.toBeNull()
  })

  it('validateMagicLink returns null for used token', async () => {
    prismaMock.magicLinkToken.findUnique.mockResolvedValue({
      id: 'token-3',
      email: 'used@example.com',
      used: true,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    })

    await expect(validateMagicLink('used-token')).resolves.toBeNull()
  })

  it('validateMagicLink marks token as used (single-use)', async () => {
    prismaMock.magicLinkToken.findUnique.mockResolvedValue({
      id: 'token-4',
      email: 'single@example.com',
      used: false,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    })

    await validateMagicLink('single-use')

    expect(prismaMock.magicLinkToken.update).toHaveBeenCalledWith({
      where: { id: 'token-4' },
      data: { used: true },
    })
  })
})
