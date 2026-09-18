import { describe, expect, it } from 'vitest'

import '../../../test/mocks'
import { prisma$Transaction, prismaMock } from '../../../test/state'
import { groupsRouter } from './index'

function makeCaller(accountId: string, resHeaders?: Headers) {
  return groupsRouter.createCaller({
    auth: {
      session: { id: 'sess-1' },
      user: {
        id: accountId,
        email: 'alice@example.com',
        emailVerified: true,
        name: 'Alice',
      },
    },
    ...(resHeaders ? { resHeaders } : {}),
  } as never)
}

describe('groups.offlineSnapshot authz', () => {
  it('rejects unauthenticated callers with UNAUTHORIZED', async () => {
    const { createTRPCContext } = await import('../../init')
    const { authState } = await import('../../../test/state')
    authState.session = null
    const ctx = await createTRPCContext({
      req: new Request('http://localhost/api/test'),
    })
    await expect(
      groupsRouter
        .createCaller({ auth: ctx.auth } as never)
        .offlineSnapshot({ groupId: 'grp-1' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('rejects nonmembers with FORBIDDEN without leaking existence', async () => {
    prismaMock.groupMember.findUnique.mockResolvedValue(null as never)
    await expect(
      makeCaller('acct-outside').offlineSnapshot({ groupId: 'grp-secret' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(prismaMock.group.findUnique).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'grp-secret' } }),
    )
  })

  it('rejects inactive memberships with FORBIDDEN', async () => {
    prismaMock.groupMember.findUnique.mockResolvedValue({
      id: 'gm-1',
      groupId: 'grp-1',
      accountId: 'acct-self',
      role: 'MEMBER',
      status: 'LEFT',
      ledgerParticipant: null,
    } as never)
    await expect(
      makeCaller('acct-self').offlineSnapshot({ groupId: 'grp-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('returns NOT_FOUND for an ACTIVE member whose group disappeared', async () => {
    prismaMock.groupMember.findUnique.mockResolvedValue({
      id: 'gm-1',
      groupId: 'grp-gone',
      accountId: 'acct-self',
      role: 'MEMBER',
      status: 'ACTIVE',
      ledgerParticipant: { id: 'lp-self' },
    } as never)
    prismaMock.group.findUnique.mockResolvedValue(null as never)
    await expect(
      makeCaller('acct-self').offlineSnapshot({ groupId: 'grp-gone' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('rejects link-token and view-key inputs without side-effect invite accept', async () => {
    prismaMock.groupMember.findUnique.mockResolvedValue({
      id: 'gm-1',
      groupId: 'grp-1',
      accountId: 'acct-self',
      role: 'MEMBER',
      status: 'ACTIVE',
      ledgerParticipant: null,
    } as never)
    const caller = makeCaller('acct-self')
    await expect(
      (caller.offlineSnapshot as unknown as (input: unknown) => unknown)({
        groupId: 'grp-1',
        linkInviteToken: 'tok-123',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      (caller.offlineSnapshot as unknown as (input: unknown) => unknown)({
        groupId: 'grp-1',
        viewKey: 'secret',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(prismaMock.groupInvitation.findFirst).not.toHaveBeenCalled()
  })

  it('uses RepeatableRead with 30s timeout and private/no-store', async () => {
    prismaMock.groupMember.findUnique.mockResolvedValue(null as never)
    const resHeaders = new Headers()
    await expect(
      makeCaller('acct-self', resHeaders).offlineSnapshot({
        groupId: 'grp-1',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(prisma$Transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: 'RepeatableRead',
        timeout: 30_000,
      }),
    )
    expect(resHeaders.get('Cache-Control')).toBe('private, no-store')
  })
})
