import { describe, expect, it } from 'vitest'
import '../test/mocks'
import { authState, prismaMock } from '../test/state'
import {
  createTRPCContext,
  loadGroupContext,
  loadGroupViewer,
  protectedProcedure,
} from './init'

function makeRequest(): Request {
  return new Request('http://localhost/api/test', {
    headers: new Headers({ cookie: 'spliit.session=test-token' }),
  })
}

describe('createTRPCContext', () => {
  it('returns null auth when better-auth reports no session', async () => {
    authState.session = null

    const ctx = await createTRPCContext({ req: makeRequest() })

    expect(ctx.auth).toBeNull()
  })

  it('returns the resolved auth when the session is valid', async () => {
    authState.session = {
      user: { id: 'acct-1' },
      session: { id: 'sess-1' },
    }
    const refreshedAccount = {
      id: 'acct-1',
      email: 'alice@example.com',
      emailVerified: true,
      name: 'Alice',
    }
    prismaMock.account.findUnique.mockResolvedValue(refreshedAccount)

    const ctx = await createTRPCContext({ req: makeRequest() })

    expect(ctx.auth).not.toBeNull()
    expect(ctx.auth?.user).toEqual(refreshedAccount)
  })
})

describe('protectedProcedure', () => {
  // Build a tiny test-only procedure whose handler returns the auth context.
  // This exercises the real protectedProcedure middleware wiring.
  const probe = protectedProcedure.query(({ ctx }) => ({
    authUserId: ctx.auth.user.id,
  }))

  async function callProbe(ctx: Awaited<ReturnType<typeof createTRPCContext>>) {
    return probe({
      ctx,
      type: 'query',
      path: 'probe',
      getRawInput: async () => undefined,
      meta: undefined,
      signal: undefined,
    } as never)
  }

  it('rejects unauthenticated callers with UNAUTHORIZED', async () => {
    authState.session = null
    const ctx = await createTRPCContext({ req: makeRequest() })

    await expect(callProbe(ctx)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
  })

  it('returns the authenticated account through the resolved context', async () => {
    authState.session = {
      user: { id: 'acct-1' },
      session: { id: 'sess-1' },
    }
    const refreshedAccount = {
      id: 'acct-1',
      email: 'alice@example.com',
      emailVerified: true,
      name: 'Alice',
    }
    prismaMock.account.findUnique.mockResolvedValue(refreshedAccount)
    const ctx = await createTRPCContext({ req: makeRequest() })

    const result = await callProbe(ctx)

    expect(result).toEqual({ authUserId: 'acct-1' })
    expect(ctx.auth).not.toBeNull()
    expect(prismaMock.account.findUnique).toHaveBeenCalledWith({
      where: { id: 'acct-1' },
    })
  })
})

describe('loadGroupContext', () => {
  const groupId = 'grp-1'
  const accountId = 'acct-1'

  it('throws NOT_FOUND when the group does not exist', async () => {
    prismaMock.group.findUnique.mockResolvedValue(null)
    prismaMock.groupMember.findUnique.mockResolvedValue(null)

    await expect(
      loadGroupContext({ groupId, accountId }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('throws FORBIDDEN when the account is not a member of the group', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      id: groupId,
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1' },
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue(null)

    await expect(
      loadGroupContext({ groupId, accountId }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('throws FORBIDDEN when the membership status is not ACTIVE', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      id: groupId,
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1' },
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue({
      groupId,
      accountId,
      role: 'MEMBER',
      status: 'LEFT',
    } as never)

    await expect(
      loadGroupContext({ groupId, accountId }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('returns the group, member, and ledger for an ACTIVE member', async () => {
    const group = {
      id: groupId,
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1', currency: '$', currencyCode: 'USD' },
    }
    const member = { groupId, accountId, role: 'OWNER', status: 'ACTIVE' }
    prismaMock.group.findUnique.mockResolvedValue(group as never)
    prismaMock.groupMember.findUnique.mockResolvedValue(member as never)

    const result = await loadGroupContext({ groupId, accountId })

    expect(result.group).toEqual(group)
    expect(result.member).toEqual(member)
    expect(result.ledger).toEqual(group.ledger)
  })
})

describe('loadGroupViewer', () => {
  const groupId = 'grp-1'
  const accountId = 'acct-1'
  const accountEmail = 'alice@example.com'

  it('throws NOT_FOUND when the group does not exist', async () => {
    prismaMock.group.findUnique.mockResolvedValue(null)
    prismaMock.groupMember.findUnique.mockResolvedValue(null)

    await expect(
      loadGroupViewer({ groupId, accountId, accountEmail }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('returns an ACTIVE viewer with member and ledger for an ACTIVE member', async () => {
    const group = {
      id: groupId,
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1', currency: '$', currencyCode: 'USD' },
    }
    const member = { groupId, accountId, role: 'OWNER', status: 'ACTIVE' }
    prismaMock.group.findUnique.mockResolvedValue(group as never)
    prismaMock.groupMember.findUnique.mockResolvedValue(member as never)

    const result = await loadGroupViewer({ groupId, accountId, accountEmail })

    expect(result.group).toEqual(group)
    expect(result.member).toEqual(member)
    expect(result.ledger).toEqual(group.ledger)
    expect(result.viewer).toEqual({ kind: 'ACTIVE' })
  })

  it('returns a PENDING_INVITEE viewer when a PENDING invitation matches the account email', async () => {
    const group = {
      id: groupId,
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1', currency: '$', currencyCode: 'USD' },
    }
    prismaMock.group.findUnique.mockResolvedValue(group as never)
    prismaMock.groupMember.findUnique.mockResolvedValue(null)
    prismaMock.groupInvitation.findFirst.mockResolvedValue({
      id: 'inv-1',
      role: 'MEMBER',
    } as never)

    const result = await loadGroupViewer({ groupId, accountId, accountEmail })

    expect(result.member).toBeNull()
    expect(result.ledger).toEqual(group.ledger)
    expect(result.viewer).toEqual({
      kind: 'PENDING_INVITEE',
      invitation: { id: 'inv-1', role: 'MEMBER' },
    })
  })

  it('falls back to a PENDING invitation when the account membership is not ACTIVE', async () => {
    const group = {
      id: groupId,
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1', currency: '$', currencyCode: 'USD' },
    }
    prismaMock.group.findUnique.mockResolvedValue(group as never)
    prismaMock.groupMember.findUnique.mockResolvedValue({
      groupId,
      accountId,
      role: 'MEMBER',
      status: 'PENDING',
    } as never)
    prismaMock.groupInvitation.findFirst.mockResolvedValue({
      id: 'inv-2',
      role: 'ADMIN',
    } as never)

    const result = await loadGroupViewer({ groupId, accountId, accountEmail })

    expect(result.member).toBeNull()
    expect(result.viewer).toEqual({
      kind: 'PENDING_INVITEE',
      invitation: { id: 'inv-2', role: 'ADMIN' },
    })
  })

  it('throws FORBIDDEN when there is no ACTIVE member and no matching PENDING invitation', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      id: groupId,
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1' },
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue(null)
    prismaMock.groupInvitation.findFirst.mockResolvedValue(null)

    await expect(
      loadGroupViewer({ groupId, accountId, accountEmail }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })
})
