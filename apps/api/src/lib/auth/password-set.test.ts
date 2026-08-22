import { hashPassword } from 'better-auth/crypto'

import '../../test/mocks'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Prisma } from '@spliit/db'

import { prismaMock, sendEmailMock } from '../../test/state'
import { passwordSet, removeLimiter, setLimiter } from './password-set'

const plugin = passwordSet()

const STRONG = 'Str0ng!Pass'

function accountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'account-1',
    email: 'user@example.com',
    emailVerified: true,
    isAnonymous: false,
    ...overrides,
  }
}

function authContext(input: {
  user?: Record<string, unknown>
  body?: Record<string, unknown>
  headers?: Headers
  path?: string
}) {
  return {
    body: input.body ?? {},
    context: {
      // Empty options → Better Auth treats the deployment as stateless, so
      // sensitiveSessionMiddleware keeps the injected session instead of
      // re-reading cookies.
      options: {},
      session: {
        session: { id: 'session-1' },
        user: {
          id: 'account-1',
          email: 'user@example.com',
          isAnonymous: false,
          ...input.user,
        },
      },
    },
    request: new Request(
      `https://api.example/auth${input.path ?? '/password/set'}`,
      { headers: input.headers ?? new Headers() },
    ),
    responseHeaders: new Headers(),
  }
}

function sessionContext(
  input: {
    user?: Record<string, unknown>
    body?: Record<string, unknown>
    headers?: Headers
  } = {},
) {
  return authContext(input) as unknown as Parameters<
    (typeof plugin)['endpoints']['setPassword']
  >[0]
}

function statusContext(
  input: { user?: Record<string, unknown>; headers?: Headers } = {},
) {
  return authContext({
    ...input,
    path: '/password/status',
  }) as unknown as Parameters<
    (typeof plugin)['endpoints']['getPasswordStatus']
  >[0]
}

function removeContext(
  input: {
    user?: Record<string, unknown>
    body?: Record<string, unknown>
    headers?: Headers
  } = {},
) {
  return authContext({
    ...input,
    path: '/password/remove',
  }) as unknown as Parameters<(typeof plugin)['endpoints']['removePassword']>[0]
}

describe('password-set plugin', () => {
  beforeEach(() => {
    setLimiter.clear()
    removeLimiter.clear()
    // restoreAllMocks would nuke the prismaMock reset from test/mocks.ts
    vi.clearAllMocks()
    prismaMock.account.findUnique.mockResolvedValue(accountRow() as never)
    prismaMock.authIdentity.findFirst.mockResolvedValue(null as never)
    prismaMock.authIdentity.findMany.mockResolvedValue([] as never)
    prismaMock.authIdentity.create.mockResolvedValue({ id: 'new' } as never)
    prismaMock.authIdentity.update.mockResolvedValue({ id: 'cred-1' } as never)
  })

  describe('getPasswordStatus', () => {
    it('returns hasPassword=false when no credential password exists', async () => {
      prismaMock.authIdentity.findFirst.mockResolvedValue(null as never)
      const ctx = statusContext()
      const res = await plugin.endpoints.getPasswordStatus(ctx)
      expect(res).toEqual({ hasPassword: false })
    })

    it('returns hasPassword=true when credential password exists', async () => {
      prismaMock.authIdentity.findFirst.mockResolvedValue({
        id: 'cred-1',
        password: 'hashed',
      } as never)
      const ctx = statusContext()
      const res = await plugin.endpoints.getPasswordStatus(ctx)
      expect(res).toEqual({ hasPassword: true })
    })

    it('rejects unauthenticated callers', async () => {
      const ctx = statusContext({ user: { id: '' } })
      await expect(
        plugin.endpoints.getPasswordStatus(ctx),
      ).rejects.toMatchObject({ body: { code: 'UNAUTHORIZED' } })
    })

    it('sets no-store headers on the response', async () => {
      prismaMock.authIdentity.findFirst.mockResolvedValue(null as never)
      const ctx = {
        ...statusContext(),
        returnHeaders: true,
      } as unknown as Parameters<
        (typeof plugin)['endpoints']['getPasswordStatus']
      >[0] & { returnHeaders: true }
      const raw = plugin.endpoints.getPasswordStatus as unknown as (
        c: typeof ctx,
      ) => Promise<{ headers: Headers; response: { hasPassword: boolean } }>
      const result = await raw(ctx)
      expect(result.headers.get('cache-control')).toBe('no-store')
      expect(result.headers.get('pragma')).toBe('no-cache')
      expect(result.response).toEqual({ hasPassword: false })
    })
  })

  describe('setPassword', () => {
    it('rejects anonymous accounts', async () => {
      prismaMock.account.findUnique.mockResolvedValue(
        accountRow({ isAnonymous: true }) as never,
      )
      await expect(
        plugin.endpoints.setPassword(
          sessionContext({ body: { newPassword: STRONG } }),
        ),
      ).rejects.toMatchObject({ body: { code: 'ANONYMOUS_REQUIRES_EMAIL' } })
    })

    it('rejects placeholder email accounts', async () => {
      prismaMock.account.findUnique.mockResolvedValue(
        accountRow({ email: '123@github.placeholder.local' }) as never,
      )
      await expect(
        plugin.endpoints.setPassword(
          sessionContext({ body: { newPassword: STRONG } }),
        ),
      ).rejects.toMatchObject({ body: { code: 'PLACEHOLDER_EMAIL' } })
    })

    it('rejects unverified email', async () => {
      prismaMock.account.findUnique.mockResolvedValue(
        accountRow({ emailVerified: false }) as never,
      )
      await expect(
        plugin.endpoints.setPassword(
          sessionContext({ body: { newPassword: STRONG } }),
        ),
      ).rejects.toMatchObject({ body: { code: 'EMAIL_NOT_VERIFIED' } })
    })

    it('rejects weak password at endpoint level', async () => {
      await expect(
        plugin.endpoints.setPassword(
          sessionContext({ body: { newPassword: 'weak' } }),
        ),
      ).rejects.toMatchObject({ body: { code: 'PASSWORD_POLICY_NOT_MET' } })
    })

    it('rejects when password already set', async () => {
      prismaMock.authIdentity.findFirst.mockResolvedValue({
        id: 'cred-1',
        password: await hashPassword(STRONG),
      } as never)
      await expect(
        plugin.endpoints.setPassword(
          sessionContext({ body: { newPassword: STRONG } }),
        ),
      ).rejects.toMatchObject({ body: { code: 'ALREADY_HAS_PASSWORD' } })
      expect(sendEmailMock).not.toHaveBeenCalled()
    })

    it('creates credential identity when none exists and emails the account', async () => {
      prismaMock.authIdentity.findFirst.mockResolvedValue(null as never)
      const ctx = sessionContext({ body: { newPassword: STRONG } })
      await expect(plugin.endpoints.setPassword(ctx)).resolves.toEqual({
        success: true,
      })
      expect(prismaMock.authIdentity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            providerId: 'credential',
            issuer: 'local:credential',
            userId: 'account-1',
            accountId: 'account-1',
          }),
        }),
      )
      expect(sendEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: 'A password was added to your Spliit Cloud account',
        }),
      )
    })

    it('updates existing credential identity with null password', async () => {
      prismaMock.authIdentity.findFirst.mockResolvedValue({
        id: 'cred-1',
        password: null,
      } as never)
      await expect(
        plugin.endpoints.setPassword(
          sessionContext({ body: { newPassword: STRONG } }),
        ),
      ).resolves.toEqual({ success: true })
      expect(prismaMock.authIdentity.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'cred-1' } }),
      )
      expect(prismaMock.authIdentity.create).not.toHaveBeenCalled()
      expect(sendEmailMock).toHaveBeenCalled()
    })

    it('still sets the password if the notice email fails', async () => {
      prismaMock.authIdentity.findFirst.mockResolvedValue(null as never)
      sendEmailMock.mockRejectedValueOnce(new Error('smtp down'))
      await expect(
        plugin.endpoints.setPassword(
          sessionContext({ body: { newPassword: STRONG } }),
        ),
      ).resolves.toEqual({ success: true })
      expect(prismaMock.authIdentity.create).toHaveBeenCalled()
    })

    it('maps a create unique-constraint race to already-has-password', async () => {
      prismaMock.authIdentity.findFirst.mockResolvedValue(null as never)
      prismaMock.authIdentity.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      )
      await expect(
        plugin.endpoints.setPassword(
          sessionContext({ body: { newPassword: STRONG } }),
        ),
      ).rejects.toMatchObject({ body: { code: 'ALREADY_HAS_PASSWORD' } })
      expect(sendEmailMock).not.toHaveBeenCalled()
    })

    it('rate-limits per account+ip', async () => {
      prismaMock.authIdentity.findFirst.mockResolvedValue(null as never)
      const headers = new Headers()
      // Isolate this case with a unique ip-shaped key: TRUST_PROXY is false in
      // tests so identity is "direct", but key is still accountId:direct — to
      // avoid cross-test bleed we cleared limiters in beforeEach and use a
      // distinct account id for the burst.
      const makeCtx = () =>
        sessionContext({
          body: { newPassword: STRONG },
          headers,
        }) as unknown as {
          context: { session: { user: { id: string } } }
          body: Record<string, unknown>
          request: Request
          responseHeaders: Headers
        } & ReturnType<typeof sessionContext>
      const accountId = `rate-set-${Date.now()}`
      for (let i = 0; i < 10; i += 1) {
        const ctx = makeCtx()
        ;(ctx.context.session.user as { id: string }).id = accountId
        prismaMock.account.findUnique.mockResolvedValue(
          accountRow({ id: accountId }) as never,
        )
        await plugin.endpoints.setPassword(ctx as never).catch(() => undefined)
      }
      const blocked = makeCtx()
      ;(blocked.context.session.user as { id: string }).id = accountId
      prismaMock.account.findUnique.mockResolvedValue(
        accountRow({ id: accountId }) as never,
      )
      await expect(
        plugin.endpoints.setPassword(blocked as never),
      ).rejects.toMatchObject({ body: { code: 'PASSWORD_RATE_LIMITED' } })
      // Retry-After is written to responseHeaders even though APIError is thrown
      expect(blocked.responseHeaders.get('Retry-After')).toBeDefined()
    })

    it('returns 401 when account row missing', async () => {
      const isolatedId = `missing-${Date.now()}`
      prismaMock.account.findUnique.mockResolvedValue(null as never)
      await expect(
        plugin.endpoints.setPassword(
          sessionContext({
            body: { newPassword: STRONG },
            user: { id: isolatedId },
          }) as never,
        ),
      ).rejects.toMatchObject({ body: { code: 'UNAUTHORIZED' } })
    })
  })

  describe('removePassword', () => {
    async function seedCredential(password = STRONG) {
      const hash = await hashPassword(password)
      prismaMock.authIdentity.findFirst.mockResolvedValue({
        id: 'cred-1',
        password: hash,
      } as never)
      return hash
    }

    it('rejects anonymous accounts', async () => {
      prismaMock.account.findUnique.mockResolvedValue(
        accountRow({ isAnonymous: true }) as never,
      )
      await expect(
        plugin.endpoints.removePassword(
          removeContext({ body: { currentPassword: STRONG } }),
        ),
      ).rejects.toMatchObject({ body: { code: 'ANONYMOUS_REQUIRES_EMAIL' } })
    })

    it('rejects when no password set', async () => {
      prismaMock.authIdentity.findFirst.mockResolvedValue(null as never)
      await expect(
        plugin.endpoints.removePassword(
          removeContext({ body: { currentPassword: STRONG } }),
        ),
      ).rejects.toMatchObject({
        body: { code: 'CREDENTIAL_ACCOUNT_NOT_FOUND' },
      })
    })

    it('rejects wrong current password', async () => {
      await seedCredential(STRONG)
      await expect(
        plugin.endpoints.removePassword(
          removeContext({ body: { currentPassword: 'Wrong1!Pass' } }),
        ),
      ).rejects.toMatchObject({ body: { code: 'INVALID_PASSWORD' } })
    })

    it('rejects removal without alternative sign-in (no other provider, unverified email)', async () => {
      await seedCredential(STRONG)
      prismaMock.account.findUnique.mockResolvedValue(
        accountRow({ emailVerified: false }) as never,
      )
      prismaMock.authIdentity.findMany.mockResolvedValue([] as never)
      await expect(
        plugin.endpoints.removePassword(
          removeContext({ body: { currentPassword: STRONG } }),
        ),
      ).rejects.toMatchObject({ body: { code: 'NO_ALTERNATIVE_SIGN_IN' } })
    })

    it('rejects removal when email is placeholder even if verified', async () => {
      await seedCredential(STRONG)
      prismaMock.account.findUnique.mockResolvedValue(
        accountRow({
          email: '123@github.placeholder.local',
          emailVerified: true,
        }) as never,
      )
      prismaMock.authIdentity.findMany.mockResolvedValue([] as never)
      await expect(
        plugin.endpoints.removePassword(
          removeContext({ body: { currentPassword: STRONG } }),
        ),
      ).rejects.toMatchObject({ body: { code: 'NO_ALTERNATIVE_SIGN_IN' } })
    })

    it('allows removal with verified real email and emails the account', async () => {
      await seedCredential(STRONG)
      prismaMock.authIdentity.findMany.mockResolvedValue([] as never)
      await expect(
        plugin.endpoints.removePassword(
          removeContext({ body: { currentPassword: STRONG } }),
        ),
      ).resolves.toEqual({ success: true })
      expect(prismaMock.authIdentity.update).toHaveBeenCalledWith({
        where: { id: 'cred-1' },
        data: { password: null },
      })
      expect(sendEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: 'A password was removed from your Spliit Cloud account',
        }),
      )
    })

    it('allows removal with another provider (oauth) even without verified email and still emails if the email is real', async () => {
      await seedCredential(STRONG)
      prismaMock.account.findUnique.mockResolvedValue(
        accountRow({
          email: 'user@example.com',
          emailVerified: false,
        }) as never,
      )
      prismaMock.authIdentity.findMany.mockResolvedValue([
        { providerId: 'google' },
      ] as never)
      await expect(
        plugin.endpoints.removePassword(
          removeContext({ body: { currentPassword: STRONG } }),
        ),
      ).resolves.toEqual({ success: true })
      // email is real (not placeholder) so the notice is still sent even though
      // the guard used the OAuth provider, not the verified-email path.
      expect(sendEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'A password was removed from your Spliit Cloud account',
        }),
      )
    })

    it('still removes the password if the notice email fails', async () => {
      await seedCredential(STRONG)
      prismaMock.authIdentity.findMany.mockResolvedValue([] as never)
      sendEmailMock.mockRejectedValueOnce(new Error('smtp down'))
      await expect(
        plugin.endpoints.removePassword(
          removeContext({ body: { currentPassword: STRONG } }),
        ),
      ).resolves.toEqual({ success: true })
      expect(prismaMock.authIdentity.update).toHaveBeenCalled()
    })

    it('rate-limits remove per account+ip', async () => {
      const accountId = `rate-remove-${Date.now()}`
      const headers = new Headers()
      for (let i = 0; i < 10; i += 1) {
        await seedCredential(STRONG)
        prismaMock.account.findUnique.mockResolvedValue(
          accountRow({ id: accountId }) as never,
        )
        prismaMock.authIdentity.findMany.mockResolvedValue([
          { providerId: 'google' },
        ] as never)
        const ctx = removeContext({
          body: { currentPassword: STRONG },
          headers,
          user: { id: accountId },
        })
        await plugin.endpoints
          .removePassword(ctx as never)
          .catch(() => undefined)
      }
      await seedCredential(STRONG)
      prismaMock.account.findUnique.mockResolvedValue(
        accountRow({ id: accountId }) as never,
      )
      prismaMock.authIdentity.findMany.mockResolvedValue([
        { providerId: 'google' },
      ] as never)
      const blocked = removeContext({
        body: { currentPassword: STRONG },
        headers,
        user: { id: accountId },
      })
      await expect(
        plugin.endpoints.removePassword(blocked as never),
      ).rejects.toMatchObject({ body: { code: 'PASSWORD_RATE_LIMITED' } })
      expect(
        (
          blocked as unknown as { responseHeaders: Headers }
        ).responseHeaders.get('Retry-After'),
      ).toBeDefined()
    })
  })
})
